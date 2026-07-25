"use client"

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShieldCheck, ShieldAlert, Loader2, Crown, CheckCircle2, XCircle, RefreshCcw } from "lucide-react";
import { useTelegram } from "@/hooks/use-telegram";
import { useToast } from "@/hooks/use-toast";
import { getValidators, getChainState } from "@/actions/mining-actions";
import { voteValidatorContract, getMyValidatorVote, proposeContractFunctionAction, voteOnContractProposalAction, listContractProposalsAction } from "@/actions/contract-actions";
import { SignatureDialog } from "@/components/SignatureDialog";

// Mirrors CONTRACTS in lib/contracts/registry.ts — duplicated here (not
// imported) because registry.ts pulls in the 'pg' driver, which must never
// end up in a client bundle.
const PROPOSAL_TARGET_CONTRACTS = [
  { label: "Staking", address: "0x0000000000000000000000000000000000c001" },
  { label: "Vesting", address: "0x0000000000000000000000000000000000c002" },
  { label: "Mining", address: "0x0000000000000000000000000000000000c003" },
  { label: "Validator", address: "0x0000000000000000000000000000000000c004" },
];
function contractLabel(address: string) {
  return PROPOSAL_TARGET_CONTRACTS.find(c => c.address === address)?.label
    || `${address.slice(0, 8)}...${address.slice(-4)}`;
}

// Same default the contract uses when no roundId is supplied — one round
// per calendar day, so all validators voting "today" land in the same
// round automatically without anyone having to type an ID in by hand.
function todayRoundId() {
  return new Date().toISOString().substring(0, 10);
}

export default function ValidatorPage() {
  const { userId, initData, user } = useTelegram();
  const { toast } = useToast();

  const [validators, setValidators] = useState<any[]>([]);
  const [networkStatus, setNetworkStatus] = useState<string>("active");
  const [loading, setLoading] = useState(true);
  const [voting, setVoting] = useState(false);
  const [pendingVote, setPendingVote] = useState<"approve" | "reject" | null>(null);
  const [sigOpen, setSigOpen] = useState(false);
  const [lastResult, setLastResult] = useState<any>(null);
  const [myVote, setMyVote] = useState<{ vote: "approve" | "reject"; votedAt: string } | null>(null);

  // ── Governance (contract-function proposals) ──
  const [proposals, setProposals] = useState<any[]>([]);
  const [showProposeForm, setShowProposeForm] = useState(false);
  const [proposeForm, setProposeForm] = useState({ contractAddress: PROPOSAL_TARGET_CONTRACTS[0].address, functionName: "", paramKeys: "" });
  const [govAction, setGovAction] = useState<{ type: "propose" } | { type: "vote"; proposalId: number; vote: "approve" | "reject" } | null>(null);
  const [govSigOpen, setGovSigOpen] = useState(false);
  const [govLoading, setGovLoading] = useState(false);

  const fetchData = async () => {
    try {
      const [vList, chain] = await Promise.all([getValidators(), getChainState()]);
      setValidators(vList || []);
      setNetworkStatus(chain?.status || "active");
      if (userId) {
        const existing = await getMyValidatorVote(userId, todayRoundId());
        setMyVote(existing);
      }
      const pending = await listContractProposalsAction("pending");
      setProposals(pending || []);
    } catch {
      // non-fatal — page still renders with whatever we have
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15_000);
    return () => clearInterval(interval);
  }, [userId]);

  const myEntry = validators.find(v => v.telegram_id === userId);
  const isValidator = !!myEntry;
  const myRank = isValidator ? validators.findIndex(v => v.telegram_id === userId) + 1 : null;

  const requestVote = (vote: "approve" | "reject") => {
    setPendingVote(vote);
    setSigOpen(true);
  };

  const confirmVote = async () => {
    if (!pendingVote || !userId) return;
    setVoting(true);
    try {
      const res = await voteValidatorContract(userId, todayRoundId(), pendingVote, initData);
      if (res.success) {
        setLastResult(res.data);
        setMyVote({ vote: pendingVote, votedAt: new Date().toISOString() });
        toast({
          title: "Vote Broadcast",
          description: res.data?.quorumReached
            ? `Quorum reached — network restored (${res.data.approveCount}/${res.data.quorumNeeded}).`
            : `Vote recorded: ${res.data?.approveCount ?? 0}/${res.data?.quorumNeeded ?? 7} approvals so far.`,
        });
        fetchData();
      } else {
        toast({ variant: "destructive", title: "Vote Rejected", description: res.error });
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err?.message || "Request failed" });
    } finally {
      setVoting(false);
      setSigOpen(false);
      setPendingVote(null);
    }
  };

  const requestGovVote = (proposalId: number, vote: "approve" | "reject") => {
    setGovAction({ type: "vote", proposalId, vote });
    setGovSigOpen(true);
  };

  const requestPropose = () => {
    if (!proposeForm.functionName.trim()) {
      toast({ variant: "destructive", title: "Missing function name", description: "Enter a function name to propose." });
      return;
    }
    setGovAction({ type: "propose" });
    setGovSigOpen(true);
  };

  const confirmGovAction = async () => {
    if (!govAction || !userId) return;
    setGovLoading(true);
    try {
      if (govAction.type === "propose") {
        const paramKeys = proposeForm.paramKeys.split(",").map(s => s.trim()).filter(Boolean);
        const res = await proposeContractFunctionAction(userId, proposeForm.contractAddress, proposeForm.functionName.trim(), paramKeys, initData);
        if (res.success) {
          toast({ title: "Proposal Submitted", description: `Needs ${res.data?.quorumRequired ?? "?"} validator approvals.` });
          setProposeForm({ contractAddress: PROPOSAL_TARGET_CONTRACTS[0].address, functionName: "", paramKeys: "" });
          setShowProposeForm(false);
        } else {
          toast({ variant: "destructive", title: "Proposal Rejected", description: res.error });
        }
      } else {
        const res = await voteOnContractProposalAction(userId, govAction.proposalId, govAction.vote, initData);
        if (res.success) {
          toast({
            title: "Vote Broadcast",
            description: res.data?.status === "approved"
              ? "Quorum reached — function is now live."
              : res.data?.status === "rejected"
                ? "Quorum reached — proposal rejected."
                : `Vote recorded: ${res.data?.approveCount ?? 0}/${res.data?.quorum ?? "?"} approvals so far.`,
          });
        } else {
          toast({ variant: "destructive", title: "Vote Rejected", description: res.error });
        }
      }
      fetchData();
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err?.message || "Request failed" });
    } finally {
      setGovLoading(false);
      setGovSigOpen(false);
      setGovAction(null);
    }
  };

  return (
    <div className="px-3 pt-4 pb-24 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-white/40 text-[10px] uppercase font-black tracking-widest">Validator Panel</p>
          <h1 className="font-headline font-bold text-2xl text-white">Consensus</h1>
        </div>
        <Button variant="ghost" size="icon" onClick={fetchData} className="h-8 w-8 text-white/40">
          <RefreshCcw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Network status */}
      <Card className="bg-card/40 border-border/30">
        <CardContent className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {networkStatus === "halted" ? (
              <ShieldAlert className="w-4 h-4 text-red-500" />
            ) : networkStatus === "recovering" ? (
              <ShieldAlert className="w-4 h-4 text-yellow-500" />
            ) : (
              <ShieldCheck className="w-4 h-4 text-green-500" />
            )}
            <span className="text-white text-sm font-bold uppercase">{networkStatus}</span>
          </div>
          {isValidator ? (
            <Badge className="bg-primary/10 text-primary border-primary/20 text-[9px] uppercase font-black">
              <Crown className="w-3 h-3 mr-1" /> Validator #{myRank}
            </Badge>
          ) : (
            <Badge variant="outline" className="text-white/30 border-white/10 text-[9px] uppercase font-black">
              Not a Validator
            </Badge>
          )}
        </CardContent>
      </Card>

      {/* Recovery vote — governance action, gas-metered & signature-verified
          via the same smart-contract engine as mining/staking/vesting */}
      <Card className="bg-card/40 border-border/30">
        <CardContent className="p-4 space-y-3">
          <p className="text-[10px] text-muted-foreground uppercase font-black">Recovery Vote — Round {todayRoundId()}</p>
          {!isValidator ? (
            <p className="text-white/30 text-xs">
              Only active validators can vote. Stake EAST via EastPass to become eligible.
            </p>
          ) : myVote ? (
            <div className={`rounded-xl p-3 flex items-center justify-between border ${
              myVote.vote === "approve"
                ? "bg-green-500/10 border-green-500/20"
                : "bg-red-500/10 border-red-500/20"
            }`}>
              <div className="flex items-center gap-2">
                {myVote.vote === "approve"
                  ? <CheckCircle2 className="w-4 h-4 text-green-400" />
                  : <XCircle className="w-4 h-4 text-red-400" />}
                <span className="text-white text-xs font-bold">
                  You voted <span className="uppercase">{myVote.vote}</span> for round {todayRoundId()}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={voting}
                onClick={() => requestVote(myVote.vote === "approve" ? "reject" : "approve")}
                className="h-7 text-[9px] uppercase font-black text-white/40 hover:text-white"
              >
                Change
              </Button>
            </div>
          ) : (
            <>
              <p className="text-white/40 text-[11px] leading-relaxed">
                Approve to confirm chain integrity and help restore the network, or reject if you
                believe the current state is invalid. Quorum needed: 7 validators.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Button
                  onClick={() => requestVote("approve")}
                  disabled={voting}
                  className="h-11 rounded-xl bg-green-600 hover:bg-green-500 text-white font-black uppercase text-[10px]"
                >
                  <CheckCircle2 className="w-4 h-4 mr-1" /> Approve
                </Button>
                <Button
                  onClick={() => requestVote("reject")}
                  disabled={voting}
                  variant="outline"
                  className="h-11 rounded-xl border-red-500/30 text-red-400 hover:bg-red-500/10 font-black uppercase text-[10px]"
                >
                  <XCircle className="w-4 h-4 mr-1" /> Reject
                </Button>
              </div>
              {lastResult && (
                <p className="text-[9px] text-white/30 text-center pt-1">
                  Last tally: {lastResult.approveCount}/{lastResult.quorumNeeded} approvals · {lastResult.totalValidators} active validators
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Contract governance — new contract functions stay UNKNOWN_CONTRACT_FUNCTION
          until a validator quorum approves them here. See governance-contract.ts. */}
      <Card className="bg-card/40 border-border/30">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-muted-foreground uppercase font-black">Contract Proposals</p>
            {(isValidator || user?.isFounder) && (
              <Button
                variant="ghost" size="sm"
                onClick={() => setShowProposeForm(v => !v)}
                className="h-6 text-[9px] uppercase font-black text-primary"
              >
                {showProposeForm ? "Cancel" : "+ Propose"}
              </Button>
            )}
          </div>

          {showProposeForm && (
            <div className="rounded-xl border border-border/30 p-3 space-y-2">
              <select
                value={proposeForm.contractAddress}
                onChange={e => setProposeForm(f => ({ ...f, contractAddress: e.target.value }))}
                className="w-full bg-black/30 border border-border/30 rounded-lg text-white text-xs p-2"
              >
                {PROPOSAL_TARGET_CONTRACTS.map(c => (
                  <option key={c.address} value={c.address}>{c.label}</option>
                ))}
              </select>
              <input
                value={proposeForm.functionName}
                onChange={e => setProposeForm(f => ({ ...f, functionName: e.target.value }))}
                placeholder="functionName (e.g. emergencyWithdraw)"
                className="w-full bg-black/30 border border-border/30 rounded-lg text-white text-xs p-2 font-code"
              />
              <input
                value={proposeForm.paramKeys}
                onChange={e => setProposeForm(f => ({ ...f, paramKeys: e.target.value }))}
                placeholder="param keys, comma-separated (e.g. amount, reason)"
                className="w-full bg-black/30 border border-border/30 rounded-lg text-white text-xs p-2 font-code"
              />
              <Button
                onClick={requestPropose}
                disabled={govLoading}
                className="w-full h-9 rounded-lg text-[10px] uppercase font-black"
              >
                Submit Proposal
              </Button>
            </div>
          )}

          {proposals.length === 0 ? (
            <p className="text-white/20 text-xs text-center py-3">No pending proposals.</p>
          ) : (
            proposals.map((p) => (
              <div key={p.id} className="rounded-xl border border-border/30 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-white text-xs font-bold font-code">
                    {contractLabel(p.contract_address)}.{p.function_name}()
                  </span>
                  <Badge variant="outline" className="text-white/40 border-white/10 text-[9px]">
                    {p.approve_count}/{p.quorum_required} approve
                  </Badge>
                </div>
                {isValidator && (
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      onClick={() => requestGovVote(p.id, "approve")}
                      disabled={govLoading}
                      size="sm"
                      className="h-8 rounded-lg bg-green-600 hover:bg-green-500 text-white font-black uppercase text-[9px]"
                    >
                      Approve
                    </Button>
                    <Button
                      onClick={() => requestGovVote(p.id, "reject")}
                      disabled={govLoading}
                      size="sm"
                      variant="outline"
                      className="h-8 rounded-lg border-red-500/30 text-red-400 hover:bg-red-500/10 font-black uppercase text-[9px]"
                    >
                      Reject
                    </Button>
                  </div>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Validator ranking */}
      <div className="space-y-2">
        <p className="text-[9px] text-white/30 uppercase font-black px-1">Top Validators — by PoC score</p>
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
        ) : validators.length === 0 ? (
          <p className="text-white/20 text-xs text-center py-6">No active validators yet.</p>
        ) : (
          validators.map((v, i) => (
            <Card key={v.telegram_id} className={`bg-card/20 border-border/20 ${v.telegram_id === userId ? "border-primary/40" : ""}`}>
              <CardContent className="p-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full bg-primary/10 text-primary text-[10px] font-black flex items-center justify-center">
                    {i + 1}
                  </div>
                  <div>
                    <p className="text-xs font-bold text-white font-code">
                      {v.wallet_address ? `${v.wallet_address.slice(0, 6)}...${v.wallet_address.slice(-4)}` : `Validator #${i + 1}`}
                    </p>
                  </div>
                </div>
                <span className="text-primary text-xs font-code font-bold">{Number(v.total_score).toFixed(1)}</span>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <SignatureDialog
        open={sigOpen}
        onOpenChange={(v) => { if (!voting) { setSigOpen(v); if (!v) setPendingVote(null); } }}
        txType={pendingVote === "reject" ? "VALIDATOR_VOTE_REJECT" : "VALIDATOR_VOTE_APPROVE"}
        from={userId ? `Validator #${myRank}` : "—"}
        to="EASTCHAIN Consensus"
        amount={0}
        gasFee={0}
        onConfirm={confirmVote}
        loading={voting}
      />

      <SignatureDialog
        open={govSigOpen}
        onOpenChange={(v) => { if (!govLoading) { setGovSigOpen(v); if (!v) setGovAction(null); } }}
        txType={
          govAction?.type === "propose" ? "GOVERNANCE_PROPOSE_FUNCTION"
            : govAction?.type === "vote" && govAction.vote === "reject" ? "GOVERNANCE_VOTE_REJECT"
              : "GOVERNANCE_VOTE_APPROVE"
        }
        from={userId ? `Validator #${myRank}` : "—"}
        to="EASTCHAIN Governance"
        amount={0}
        gasFee={0}
        onConfirm={confirmGovAction}
        loading={govLoading}
      />
    </div>
  );
}
