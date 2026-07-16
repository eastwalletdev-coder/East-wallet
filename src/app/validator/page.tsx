"use client"

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShieldCheck, ShieldAlert, Loader2, Crown, CheckCircle2, XCircle, RefreshCcw } from "lucide-react";
import { useTelegram } from "@/hooks/use-telegram";
import { useToast } from "@/hooks/use-toast";
import { getValidators, getChainState } from "@/actions/mining-actions";
import { voteValidatorContract, getMyValidatorVote } from "@/actions/contract-actions";
import { SignatureDialog } from "@/components/SignatureDialog";

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

  const fetchData = async () => {
    try {
      const [vList, chain] = await Promise.all([getValidators(), getChainState()]);
      setValidators(vList || []);
      setNetworkStatus(chain?.status || "active");
      if (userId) {
        const existing = await getMyValidatorVote(userId, todayRoundId());
        setMyVote(existing);
      }
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
    </div>
  );
}
