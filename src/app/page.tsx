"use client"

import { useState, useEffect } from "react";
import { Zap, Globe, Send, ArrowDownLeft, Copy, CheckCheck, Activity, RefreshCcw, Archive, ShieldCheck, CheckCircle2, Cpu, Store, ArrowUpRight, Lock, Clock, Radio, ChevronDown } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { TradingTerminal } from "@/components/p2p/TradingTerminal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { claimMiningReward, getChainState, performRollingArchive, initiateConsensusRecovery } from "@/actions/mining-actions";
import { useTelegram } from "@/hooks/use-telegram";
import { getTierFromStaked } from "@/lib/ledger";
import { useToast } from "@/hooks/use-toast";
import { ReceiveDialog } from "@/components/ReceiveDialog";
import { SendDialog } from "@/components/SendDialog";
import { SignatureDialog } from "@/components/SignatureDialog";
import { AuditTrailSheet } from "@/components/AuditTrailSheet";
import { getEastTransactions, type Transaction } from "@/lib/transaction-service";
import { MINING_REWARD } from "@/lib/blockchain";
import { cn } from "@/lib/utils";
import { getLightNodeClient, type LightNodeState } from "@/lib/lightnode/client";

const MIN_VERIFIED_HEADERS = 5;
const MIN_PARTICIPATION_SECONDS = 120;

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const { userId, user, initData, loading: userLoading, refreshUser } = useTelegram();
  const { toast } = useToast();

  const [nodeState, setNodeState] = useState<LightNodeState | null>(null);
  const [isClaiming, setIsClaiming] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);
  const [isRolling, setIsRolling] = useState(false);
  const [networkStatus, setNetworkStatus] = useState('active');
  const [blockCount, setBlockCount] = useState(0);
  const [copied, setCopied] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [countdown, setCountdown] = useState(0); // remaining seconds
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [txLoading, setTxLoading] = useState(true);
  const [sigOpen, setSigOpen] = useState(false);
  const [activityCollapsed, setActivityCollapsed] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  // Fetch cooldown on load
  useEffect(() => {
    if (!userId) return;
    fetch(`/api/cooldown?tgId=${userId}`)
      .then(r => r.json())
      .then(d => { if (!d.allowed && d.remainingSeconds > 0) setCountdown(d.remainingSeconds); })
      .catch(() => {});
  }, [userId]);

  // Countdown tick
  useEffect(() => {
    if (countdown <= 0) return;
    const t = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) { clearInterval(t); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [countdown]);

  useEffect(() => {
    async function fetchChain() {
      try {
        const state = await getChainState();
        setNetworkStatus(state.status || 'active');
        setBlockCount(state.blockCount || 0);
      } catch {}
    }
    fetchChain();
    const interval = setInterval(fetchChain, 30_000);
    return () => clearInterval(interval);
  }, []);

  const isNetworkHalted = networkStatus === 'halted';
  const isNetworkRecovering = networkStatus === 'recovering';
  const tier = getTierFromStaked(user?.stakedAmount || 0);
  const walletAddress = user?.walletAddress || '0x...';

  const isConnecting = nodeState?.connectionStatus === 'connecting';
  const isConnected = nodeState?.connectionStatus === 'connected';
  const isNodeActive = isConnecting || isConnected;
  const isReadyToClaim = nodeState?.eligible === true;
  const headerPct = nodeState ? Math.min(100, (nodeState.verifiedHeaderCount / MIN_VERIFIED_HEADERS) * 100) : 0;
  const timePct = nodeState ? Math.min(100, (nodeState.participationSeconds / MIN_PARTICIPATION_SECONDS) * 100) : 0;
  const progress = isReadyToClaim ? 100 : Math.min(headerPct, timePct);

  useEffect(() => {
    if (!walletAddress || walletAddress === '0x...') { setTxLoading(false); return; }
    let cancelled = false;
    async function fetchTx() {
      setTxLoading(true);
      try {
        const data = await getEastTransactions(walletAddress);
        if (!cancelled) setTransactions(data);
      } catch {
      } finally {
        if (!cancelled) setTxLoading(false);
      }
    }
    fetchTx();
    const interval = setInterval(fetchTx, 30_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [walletAddress]);

  useEffect(() => {
    const client = getLightNodeClient();
    const unsub = client.subscribe(setNodeState);
    return () => { unsub(); };
  }, []);

  const formatCountdown = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  };

  const handleClaimRequest = () => {
    if (isClaiming || !isReadyToClaim) return;
    setSigOpen(true);
  };

  const handleClaim = async () => {
    setIsClaiming(true);
    try {
      const result = await claimMiningReward(userId, initData);
      if (result.success) {
        toast({ title: "Block Verified", description: `+${result.reward} EAST mined.` });
        setCountdown(24 * 60 * 60);
        getLightNodeClient().markClaimed(String(result.blockIndex ?? Date.now()));
        refreshUser();
      } else {
        toast({ variant: "destructive", title: "Rejected", description: result.error });
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err?.message || "Request failed" });
    } finally {
      // Always reset claiming/dialog state regardless of success/error/timeout
      setIsClaiming(false);
      setSigOpen(false);
    }
  };

  const handleCopyAddress = async () => {
    try { await navigator.clipboard.writeText(walletAddress); }
    catch {
      const el = document.createElement('textarea'); el.value = walletAddress;
      document.body.appendChild(el); el.select(); document.execCommand('copy'); document.body.removeChild(el);
    }
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  const handleRecovery = async () => {
    setIsRecovering(true);
    const result = await initiateConsensusRecovery(userId, initData);
    if (result.success) { toast({ title: "Consensus Recovered" }); setNetworkStatus('active'); }
    else toast({ variant: "destructive", title: "Recovery Failed", description: result.error });
    setIsRecovering(false);
  };

  const handlePrune = async () => {
    if (blockCount < 10) { toast({ description: "Not enough blocks to archive yet." }); return; }
    setIsRolling(true);
    const result = await performRollingArchive(blockCount - 5, userId, initData);
    if (result.success) toast({ title: "Archived", description: `${result.count} blocks moved to Cold Storage.` });
    else toast({ variant: "destructive", title: "Archive Failed", description: result.error });
    setIsRolling(false);
  };

  return (
    <div className="flex flex-col min-h-[85vh] relative overflow-x-hidden pb-10">

      {/* ── GLOBE SECTION — full width, no card, no border ── */}
      <div className="relative w-full flex flex-col items-center">

        {/* Background purple glow behind globe */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[420px] bg-primary/10 rounded-full blur-[80px] pointer-events-none" />

        {/* Header text overlay */}
        <div className="relative z-10 flex flex-col items-center text-center pt-4 pb-2 px-4">
          <h2 className="text-5xl font-bold tracking-tight uppercase flex items-center justify-center filter drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] relative">
            <div className="flex items-center relative z-10">
              <span className="font-logo text-primary translate-x-[-0.1em]">E</span>
              <span className="font-logo mx-0.5 text-white text-[1.15em] font-normal leading-none translate-y-[-0.05em]">Λ</span>
              <span className="font-logo text-primary">ST</span>
            </div>
            <div className="absolute inset-0 flex items-center justify-center mix-blend-screen pointer-events-none z-20">
              <div className="flex items-center animate-shimmer-shine bg-[linear-gradient(to_right,transparent_30%,white_50%,transparent_70%)] bg-[length:200%_auto] bg-clip-text text-transparent">
                <span className="font-logo translate-x-[-0.1em]">E</span>
                <span className="font-logo mx-0.5 text-[1.15em] font-normal leading-none translate-y-[-0.05em]">Λ</span>
                <span className="font-logo">ST</span>
              </div>
            </div>
          </h2>
          <p className="text-[13px] uppercase font-black tracking-[0.1em] text-white leading-tight mt-2">
            First Non-custodial Web 3.0 Wallet
          </p>
          <p className="text-[10px] uppercase font-extrabold tracking-[0.2em] text-primary mt-1">
            Secure With Hybrid Consensus Ledger
          </p>
        </div>

        {/* Globe — full width, no container card */}
        <div className="relative w-full flex items-center justify-center" style={{ height: '380px' }}>
          {/* Subtle glow only — no border, no background */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-[360px] h-[360px] rounded-full shadow-[0_0_140px_-20px_rgba(139,92,246,0.6)] animate-pulse opacity-70" />
          </div>

          {/* Globe grid — no background card */}
          <div className="relative w-[360px] h-[360px] flex items-center justify-center" style={{ perspective: "800px", transformStyle: "preserve-3d" }}>
            {/* Orbiting beam — identical pattern to SplashScreen's globe beam */}
            <div
              className="absolute inset-0 z-40 animate-rotate-beam pointer-events-none"
            >
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[360px] h-[2px] bg-gradient-to-r from-transparent via-white/100 to-transparent blur-[2px]" />
            </div>

            {/* Vertical grid lines (spinning) */}
            <div className="absolute inset-0 flex items-center justify-center animate-globe-spin" style={{ transformStyle: 'preserve-3d' }}>
              {[...Array(10)].map((_, i) => (
                <div key={`v-${i}`}
                  className="absolute inset-0 border-x border-primary/50 rounded-full"
                  style={{ transform: `rotateY(${i * 18}deg)`, borderWidth: '1px' }}
                />
              ))}
            </div>

            {/* Horizontal grid lines */}
            <div className="absolute inset-0 flex flex-col justify-around py-4 opacity-80 z-10 pointer-events-none">
              {[...Array(8)].map((_, i) => (
                <div key={`h-${i}`}
                  className="w-full h-[1px] bg-primary/40"
                  style={mounted ? { opacity: 0.3 + (Math.sin(((i + 0.5) / 12) * Math.PI) * 0.7) } : {}}
                />
              ))}
            </div>

            {/* Highlight */}
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_25%,rgba(255,255,255,0.08)_0%,transparent_50%)] z-20 pointer-events-none rounded-full" />
          </div>
        </div>

        {/* Status badges */}
        <div className="relative z-10 flex items-center gap-10 opacity-50 mb-4">
          <div className="flex flex-col items-center gap-1">
            <Zap className="w-4 h-4 text-primary" />
            <span className="text-[7px] font-bold uppercase tracking-[0.3em]">Hybrid Ledger Active</span>
          </div>
          <div className="w-[1px] h-6 bg-foreground/10" />
          <div className="flex flex-col items-center gap-1">
            <Globe className="w-4 h-4 text-foreground" />
            <span className="text-[7px] font-bold uppercase tracking-[0.3em]">Global Node Active</span>
          </div>
        </div>
      </div>

      {/* ── CONTENT SECTION — cards below globe ── */}
      <div className="flex flex-col gap-3 px-3">

        {/* Mining Balance Card */}
        <Card className="glass-card overflow-hidden border-white/5 w-full">
          <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
          <CardContent className="p-5">
            <div className="flex justify-between items-start">
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <ShieldCheck className="w-3 h-3 text-primary opacity-80" />
                  <p className="text-white/40 text-[10px] font-black uppercase tracking-[0.2em]">Mining Balance</p>
                </div>
                <h3 className="text-3xl font-code font-bold text-white tracking-tighter">
                  {userLoading ? "---" : (user?.balance || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  <span className="text-primary text-xs ml-2 font-black italic">EAST</span>
                </h3>
                <div className="flex items-center space-x-3 pt-1">
                  <Badge className="bg-white/10 text-white border-white/5 text-[9px] font-bold uppercase">{tier.name}</Badge>
                  <div className="flex items-center space-x-1 text-primary">
                    <Cpu className="w-3 h-3" />
                    <span className="text-[10px] font-black uppercase">{tier.boost}x Efficiency</span>
                  </div>
                </div>
              </div>
              <div className={cn("p-3 rounded-2xl transition-all duration-700",
                isNodeActive ? "bg-primary/20 scale-110" : isReadyToClaim ? "bg-green-500/20" : "bg-white/5")}>
                {isReadyToClaim
                  ? <CheckCircle2 className="w-5 h-5 text-green-500" />
                  : <Zap className={cn("w-5 h-5", isNodeActive ? "text-primary fill-primary" : "text-white/20")} />}
              </div>
            </div>
            <div className="mt-4 space-y-1.5">
              <div className="flex justify-between text-[9px] font-black uppercase tracking-[0.15em]">
                <span className="text-white/30">Node Participation</span>
                <span className={isReadyToClaim ? "text-green-500" : isNodeActive ? "text-primary" : "text-white/30"}>
                  {isReadyToClaim ? "Ready to Claim" :
                    isConnecting ? "Connecting Node..." :
                    isConnected ? `${nodeState?.verifiedHeaderCount ?? 0}/${MIN_VERIFIED_HEADERS} headers · ${nodeState?.participationSeconds ?? 0}/${MIN_PARTICIPATION_SECONDS}s` :
                    "Standby"}
                </span>
              </div>
              <div className="relative h-1 w-full bg-white/5 rounded-full overflow-hidden">
                <div className={cn("absolute top-0 left-0 h-full transition-all duration-300",
                  isReadyToClaim ? "bg-green-500" : isNodeActive ? "bg-primary" : "bg-white/10")}
                  style={{ width: `${progress}%` }} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Mining Buttons */}
        <div className="flex flex-col gap-3">
          {countdown > 0 ? (
            <div className="w-full h-14 rounded-2xl bg-white/5 border border-white/10 flex flex-col items-center justify-center gap-0.5">
              <span className="text-[9px] font-black uppercase tracking-[0.3em] text-white/30">Next Claim In</span>
              <span className="text-2xl font-code font-bold text-primary tracking-widest">{formatCountdown(countdown)}</span>
            </div>
          ) : isNetworkRecovering ? (
            <Button onClick={handleRecovery} disabled={isRecovering}
              className="w-full h-14 bg-yellow-600 hover:bg-yellow-500 text-white rounded-2xl font-black uppercase tracking-widest">
              <RefreshCcw className={cn("w-4 h-4 mr-2", isRecovering && "animate-spin")} />
              Sign Consensus Recovery
            </Button>
          ) : isReadyToClaim ? (
            <Button onClick={handleClaimRequest} disabled={isClaiming}
              className="w-full h-14 rounded-2xl bg-green-600 hover:bg-green-500 text-white font-black uppercase tracking-widest">
              {isClaiming ? <RefreshCcw className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
              {isClaiming ? "Broadcasting..." : "Claim Mining Reward"}
            </Button>
          ) : (
            <Button
              disabled={isNetworkHalted || isNodeActive}
              onClick={() => getLightNodeClient().connect()}
              className={cn("w-full h-14 rounded-2xl font-black uppercase tracking-widest border-0",
                isNodeActive ? "bg-white/5 text-white/20 cursor-wait" : "bg-primary text-white hover:opacity-90")}>
              {isConnecting ? <Radio className="w-4 h-4 mr-2 animate-pulse" /> : isConnected ? <Activity className="w-4 h-4 mr-2 animate-pulse" /> : <Zap className="w-4 h-4 mr-2 fill-white" />}
              {isNetworkHalted ? "Network Locked" : isConnecting ? "Connecting Node..." : isConnected ? "Node Active — Verifying..." : "Initiate Mining Cycle"}
            </Button>
          )}
          <Button variant="outline" onClick={handlePrune} disabled={isRolling || isNodeActive}
            className="h-12 rounded-2xl border-white/5 bg-white/5 hover:bg-white/10 text-white/40 text-[10px] font-black uppercase">
            <Archive className="w-4 h-4 mr-2 opacity-50" />Prune L2
          </Button>
          {user?.isFounder ? (
            <AuditTrailSheet telegramId={userId} initData={initData} isFounder={!!user?.isFounder} />
          ) : (
            <Button variant="outline" disabled
              className="h-12 rounded-2xl border-white/5 bg-white/5 text-white/20 text-[10px] font-black uppercase cursor-not-allowed">
              Audit Chain
            </Button>
          )}
        </div>
        {/* end Mining Buttons */}

`${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : walletAddress}
        amount={MINING_REWARD * getTierFromStaked(user?.stakedAmount || 0).boost}
        gasFee={0}
        onConfirm={handleClaim}
        loading={isClaiming}
      />
    </div>
  );
}