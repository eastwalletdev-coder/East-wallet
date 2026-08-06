"use client"

import { useState, useEffect } from "react";
import Link from "next/link";
import { Zap, Globe, Send, ArrowDownLeft, Copy, CheckCheck, Check, Activity, RefreshCcw, Archive, ShieldCheck, ShieldAlert, CheckCircle2, Cpu, Store, ArrowUpRight, Lock, Clock, Radio, ChevronDown, X, Loader2 } from "lucide-react";
import { LightNodePanel } from "@/components/LightNodePanel";
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
import { useWallet } from "@/lib/wallet-context";
import { getEvmIdentity } from "@/lib/wallet-service";
import { SignatureDialog } from "@/components/SignatureDialog";
import { AuditTrailSheet } from "@/components/AuditTrailSheet";
import { getEastTransactions, getPendingEastTransactions, type Transaction, type PendingTransaction } from "@/lib/transaction-service";
import { listLocalActivity, listAllLocalActivity, type LocalActivity } from "@/lib/chain-activity-local";
import { FullNodeConsentDialog } from "@/components/FullNodeConsentDialog";
import { checkFullNodeAgreement, agreeToFullNodeTerms, setFullNodeActiveStatus } from "@/actions/full-node-actions";
import { getLightNodeClient } from "@/lib/lightnode/client";
import { MINING_REWARD } from "@/lib/blockchain";
import { cn } from "@/lib/utils";

const MIN_VERIFIED_HEADERS = 2;
const MIN_PARTICIPATION_SECONDS = 120;

/** Small inline copy-to-clipboard button for tx hashes in the activity log. */
function CopyTxButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async (e: { stopPropagation: () => void }) => {
    e.stopPropagation(); // don't collapse the row when copying
    try { await navigator.clipboard.writeText(text); }
    catch {
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 px-2 py-0.5 rounded-md border border-primary/30 text-primary text-[9px] font-bold uppercase shrink-0 ml-2 hover:bg-primary/10 transition-colors"
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const { userId, user, initData, loading: userLoading, refreshUser } = useTelegram();
  const { mnemonic, isLocked } = useWallet();

  // Upgrade-to-self-custody reminder banner: dismissible, remembered per
  // Telegram account (not just per-device) via a userId-scoped localStorage
  // key. Only relevant for users who aren't self-custody EVM yet.
  useEffect(() => {
    if (!userId) return;
    try {
      const dismissed = localStorage.getItem(`eastchain_upgrade_banner_dismissed_${userId}`);
      setUpgradeBannerDismissed(dismissed === '1');
    } catch {
      setUpgradeBannerDismissed(false); // localStorage unavailable (e.g. private mode) — default to showing it
    }
  }, [userId]);

  const dismissUpgradeBanner = () => {
    setUpgradeBannerDismissed(true);
    if (userId) {
      try { localStorage.setItem(`eastchain_upgrade_banner_dismissed_${userId}`, '1'); } catch {}
    }
  };
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
  const [upgradeBannerDismissed, setUpgradeBannerDismissed] = useState(true); // default true until we know userId, avoids a flash
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [pendingTransactions, setPendingTransactions] = useState<PendingTransaction[]>([]);
  const [localActivity, setLocalActivity] = useState<LocalActivity[]>([]);
  const [expandedTxId, setExpandedTxId] = useState<string | null>(null);
  const [txLoading, setTxLoading] = useState(true);
  const [sigOpen, setSigOpen] = useState(false);
  const [activityCollapsed, setActivityCollapsed] = useState(false); // show Send/pending by default
  const [lightNodeMode, setLightNodeMode] = useState(false);
  const [fullNodeOpen, setFullNodeOpen] = useState(false);
  const [fullNodeLoading, setFullNodeLoading] = useState(false);
  const [fullNodeOn, setFullNodeOn] = useState(false);
  const [onchainAmount, setOnchainAmount] = useState("");
  const [onchainLoading, setOnchainLoading] = useState(false);
  const [onchainMsg, setOnchainMsg] = useState<string | null>(null);


  useEffect(() => { setMounted(true); }, []);

  
  async function handleEnableFullNode() {
    if (!userId) return;
    setFullNodeLoading(true);
    try {
      const initData =
        typeof window !== "undefined" && (window as any).Telegram?.WebApp?.initData
          ? (window as any).Telegram.WebApp.initData
          : undefined;
      const client = getLightNodeClient();
      const nid = nodeState?.nodeId || "unknown";
      const agree = await agreeToFullNodeTerms(String(userId), nid, initData);
      if (!agree?.success) {
        toast({ variant: "destructive", title: "Full node agreement failed", description: agree?.error || "Auth error" });
        return;
      }
      await setFullNodeActiveStatus(String(userId), true, initData);
      client.setFullNodeEnabled(true);
      setFullNodeOn(true);
      setFullNodeOpen(false);
      toast({ title: "Full lightnode enabled", description: "This device will keep a balance replica and answer RPC reads when selected." });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Full node enable failed", description: e?.message || "Error" });
    } finally {
      setFullNodeLoading(false);
    }
  }

  async function handleDisableFullNode() {
    if (!userId) return;
    setFullNodeLoading(true);
    try {
      const initData =
        typeof window !== "undefined" && (window as any).Telegram?.WebApp?.initData
          ? (window as any).Telegram.WebApp.initData
          : undefined;
      await setFullNodeActiveStatus(String(userId), false, initData);
      getLightNodeClient().setFullNodeEnabled(false);
      setFullNodeOn(false);
      toast({ title: "Full lightnode disabled" });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Disable failed", description: e?.message || "Error" });
    } finally {
      setFullNodeLoading(false);
    }
  }

async function handleTransferOnchain() {
    if (!user?.telegramId) {
      setOnchainMsg("Login required");
      return;
    }
    const amount = parseFloat(onchainAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setOnchainMsg("Enter a valid amount");
      return;
    }
    if (amount > (user.balance || 0)) {
      setOnchainMsg("Amount exceeds mining (Neon) balance");
      return;
    }
    setOnchainLoading(true);
    setOnchainMsg(null);
    try {
      const initData =
        typeof window !== "undefined" && (window as any).Telegram?.WebApp?.initData
          ? (window as any).Telegram.WebApp.initData
          : undefined;
      // Home bridge only: Neon mining → validator. Not Wallet peer-Send.
      const res = await fetch("/api/chain/transfer-onchain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telegramId: String(user.telegramId),
          amount,
          // Prefer unlocked vault address so deposit credits the same addr as Wallet/Receive
          toAddress: (!isLocked && mnemonic)
            ? getEvmIdentity(mnemonic).address
            : user.walletAddress,
          initData,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setOnchainMsg(data.error || "Deposit to chain failed");
        return;
      }
      setOnchainMsg(
        `Deposited · Neon left ${data.neonBalanceAfter} · Chain ${data.onchainBalanceAfterHuman} EAST`,
      );
      setOnchainAmount("");
      try { refreshUser(); } catch { /* ignore */ }
    } catch (e: any) {
      setOnchainMsg(e?.message || "Network error");
    } finally {
      setOnchainLoading(false);
    }
  }


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
        const [confirmed, pending] = await Promise.all([
          getEastTransactions(walletAddress),
          getPendingEastTransactions(walletAddress),
        ]);
        // Device-local on-chain sends (vault addr may differ from profile walletAddress)
        const local = listAllLocalActivity();
        if (!cancelled) {
          setTransactions(confirmed);
          setPendingTransactions(pending);
          setLocalActivity(local);
        }
      } catch {
      } finally {
        if (!cancelled) setTxLoading(false);
      }
    }
    fetchTx();
    // Pending tx can seal within seconds (gas-priority mempool + QStash
    // backstop, see block-engine.ts) — poll faster than the confirmed-only
    // 30s interval so a "pending" badge doesn't linger looking stale.
    const interval = setInterval(fetchTx, pendingTransactions.length > 0 ? 5_000 : 30_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [walletAddress, pendingTransactions.length]);

  // Instant refresh when SendDialog writes local activity
  useEffect(() => {
    const onAct = () => setLocalActivity(listAllLocalActivity());
    if (typeof window === 'undefined') return;
    window.addEventListener('east-chain-activity', onAct as EventListener);
    window.addEventListener('focus', onAct);
    return () => {
      window.removeEventListener('east-chain-activity', onAct as EventListener);
      window.removeEventListener('focus', onAct);
    };
  }, []);


  useEffect(() => {
    const client = getLightNodeClient();
    const unsub = client.subscribe(setNodeState);
    try { setFullNodeOn(client.isFullNodeEnabled()); } catch { /* ignore */ }
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
      const result = await claimMiningReward(userId, initData, nodeState?.verifiedHeaderCount ?? 0);
      if (result.success) {
        toast({ title: "Block Verified", description: `+${result.reward} EAST mined.` });
        setCountdown(24 * 60 * 60);
        getLightNodeClient().markClaimed(String(result.epoch ?? Date.now()));
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

  const handleEnterLightNode = () => {
    getLightNodeClient().connect();
    setLightNodeMode(true);
  };

  const handleExitLightNode = () => {
    getLightNodeClient().disconnect();
    setLightNodeMode(false);
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
              <span className="font-logo text-primary -translate-x-[0.03em] mr-[0.05em] leading-none">E</span>
              <span className="font-logo mx-[0.12em] text-white text-[1.15em] font-normal leading-none translate-y-[-0.05em]">Λ</span>
              <span className="font-logo text-primary leading-none">ST</span>
            </div>
            {/* Classic letter shine (bg-clip) — spacing E/A unchanged */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
              <div
                className="flex items-center animate-shimmer-shine text-transparent bg-clip-text select-none"
                style={{
                  backgroundImage:
                    'linear-gradient(90deg, transparent 0%, transparent 40%, rgba(255,255,255,0.85) 50%, transparent 60%, transparent 100%)',
                  backgroundSize: '200% 100%',
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                }}
              >
                <span className="font-logo -translate-x-[0.03em] mr-[0.05em] leading-none">E</span>
                <span className="font-logo mx-[0.12em] text-[1.15em] font-normal leading-none translate-y-[-0.05em]">Λ</span>
                <span className="font-logo leading-none">ST</span>
              </div>
            </div>
          </h2>
          <p className="text-[13px] uppercase font-black tracking-[0.1em] text-white leading-tight mt-2">
            One Smartphone One Node One Future
          </p>
          <p className="text-[10px] uppercase font-extrabold tracking-[0.2em] text-primary mt-1">
            Layer 1 Secure With P2P Mobile Browser Lightnode
          </p>
        </div>

        {/* Globe — sized relative to viewport with side padding so it never touches the screen edge */}
        <div
          className="relative w-full flex items-center justify-center px-8"
          style={{ height: 'min(380px, calc(78vw + 20px))', ['--globe-size' as any]: 'min(360px, 78vw)' }}
        >
          {/* Subtle glow only — no border, no background */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="rounded-full shadow-[0_0_140px_-20px_rgba(139,92,246,0.6)] animate-pulse opacity-70" style={{ width: 'var(--globe-size)', height: 'var(--globe-size)' }} />
          </div>

          {/* Globe grid — no background card */}
          <div className="relative rounded-full overflow-hidden flex items-center justify-center" style={{ width: 'var(--globe-size)', height: 'var(--globe-size)', perspective: "800px", transformStyle: "preserve-3d" }}>
            {/* Orbiting beam — identical pattern to SplashScreen's globe beam */}
            <div
              className="absolute inset-0 z-40 animate-rotate-beam pointer-events-none"
            >
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[2px] bg-gradient-to-r from-transparent via-white/100 to-transparent blur-[2px]" />
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

        {/* Self-custody upgrade reminder — non-blocking, dismissible, only
            shown to users still on the legacy server-derived wallet. */}
        {!userLoading && user && user.walletType !== 'self_custody_evm' && !upgradeBannerDismissed && (
          <Link href="/profile">
            <div className="flex items-center gap-3 p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20">
              <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-amber-400 text-[10px] font-black uppercase tracking-widest">Secure Your Wallet</p>
                <p className="text-white/50 text-[10px] leading-tight">Upgrade to self-custody — you hold the private key, not the server.</p>
              </div>
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); dismissUpgradeBanner(); }}
                className="shrink-0 p-1 text-white/30 hover:text-white/60"
                aria-label="Dismiss"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </Link>
        )}

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
                isNodeActive ? "bg-primary/20 scale-110" : isReadyToClaim ? "bg-white/20" : "bg-white/5")}>
                {isReadyToClaim
                  ? <CheckCircle2 className="w-5 h-5 text-white" />
                  : <Zap className={cn("w-5 h-5", isNodeActive ? "text-primary fill-primary" : "text-white/20")} />}
              </div>
            </div>
            <div className="mt-4 space-y-1.5">
              <div className="flex justify-between text-[9px] font-black uppercase tracking-[0.15em]">
                <span className="text-white/30">Node Participation</span>
                <span className={isReadyToClaim ? "text-white" : isNodeActive ? "text-primary" : "text-white/30"}>
                  {isReadyToClaim ? "Ready to Claim" :
                    isConnecting ? "Connecting Node..." :
                    isConnected ? `${nodeState?.verifiedHeaderCount ?? 0}/${MIN_VERIFIED_HEADERS} headers · ${nodeState?.participationSeconds ?? 0}/${MIN_PARTICIPATION_SECONDS}s` :
                    "Standby"}
                </span>
              </div>
              <div className="relative h-1 w-full bg-white/5 rounded-full overflow-hidden">
                <div className={cn("absolute top-0 left-0 h-full transition-all duration-300",
                  isReadyToClaim ? "bg-white" : isNodeActive ? "bg-primary" : "bg-white/10")}
                  style={{ width: `${progress}%` }} />
              </div>
            </div>

            {/* Deposit mining → chain (Neon bridge). Wallet Send is separate. */}
            <div className="mt-5 pt-4 border-t border-white/5 space-y-2">
              <p className="text-[9px] font-black uppercase tracking-[0.2em] text-white/30">
                Deposit mining → chain
              </p>
              <p className="text-[10px] text-white/40 leading-relaxed">
                Move mining rewards from Neon to free balance on the validator.
                Neon decreases; on-chain wallet increases. This is not a peer transfer —
                use Wallet → Send to transfer to another user.
              </p>
              <div className="flex gap-2">
                <input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="Amount EAST"
                  value={onchainAmount}
                  onChange={(e) => setOnchainAmount(e.target.value)}
                  className="flex-1 h-11 rounded-xl bg-white/5 border border-white/10 px-3 text-sm text-white outline-none focus:border-primary/50"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 px-3 rounded-xl border-white/10 text-[10px] font-black uppercase"
                  onClick={() => setOnchainAmount(String(user?.balance || 0))}
                  disabled={!user?.balance}
                >
                  Max
                </Button>
              </div>
              <Button
                type="button"
                onClick={handleTransferOnchain}
                disabled={onchainLoading || !user?.balance}
                className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-black uppercase text-[11px] tracking-wider"
              >
                {onchainLoading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Depositing…
                  </span>
                ) : (
                  "Deposit to chain"
                )}
              </Button>
              {onchainMsg && (
                <p className="text-[10px] text-primary/90 break-all">{onchainMsg}</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Mining Buttons */}
        <div className="flex flex-col gap-3">
          {lightNodeMode ? (
            <div className="relative">
              <button
                onClick={handleExitLightNode}
                aria-label="Exit Light Node Mode"
                className="absolute -top-2 -right-2 z-10 w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 border border-white/10 flex items-center justify-center"
              >
                <X className="w-4 h-4 text-white" />
              </button>
              <LightNodePanel />
            </div>
          ) : (
            <>
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
                  onClick={handleEnterLightNode}
                  className={cn("w-full h-14 rounded-2xl font-black uppercase tracking-widest border-0",
                    isNodeActive ? "bg-white/5 text-white/20 cursor-wait" : "bg-primary text-white hover:opacity-90")}>
                  {isConnecting ? <Radio className="w-4 h-4 mr-2 animate-pulse" /> : isConnected ? <Activity className="w-4 h-4 mr-2 animate-pulse" /> : <Zap className="w-4 h-4 mr-2 fill-white" />}
                  {isNetworkHalted ? "Network Locked" : isConnecting ? "Connecting Node..." : isConnected ? "Node Active — Verifying..." : "Synchronize Node"}
                </Button>
              )}
              <Button
                onClick={handleEnterLightNode}
                className="w-full h-14 rounded-2xl font-black uppercase tracking-widest border-0 bg-primary text-white hover:opacity-90"
              >
                <Radio className="w-4 h-4 mr-2" />
                Light Node
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={fullNodeLoading || !isConnected}
                onClick={() => {
                  if (fullNodeOn) handleDisableFullNode();
                  else setFullNodeOpen(true);
                }}
                className="w-full h-12 rounded-2xl font-black uppercase tracking-widest border-white/10 bg-white/5 text-white/80"
              >
                {fullNodeLoading ? "Working…" : fullNodeOn ? "Full lightnode · ON" : "Enable full lightnode"}
              </Button>
              {!isConnected && (
                <p className="text-[10px] text-white/40 text-center">Connect Light Node first, then enable full mode.</p>
              )}
            </>
          )}
          {user?.isFounder && (
            <>
              <Button variant="outline" onClick={handlePrune} disabled={isRolling || isNodeActive}
                className="h-12 rounded-2xl border-white/5 bg-white/5 hover:bg-white/10 text-white/40 text-[10px] font-black uppercase">
                <Archive className="w-4 h-4 mr-2 opacity-50" />Prune L2
              </Button>
              <AuditTrailSheet telegramId={userId} initData={initData} isFounder={!!user?.isFounder} />
            </>
          )}
        </div>
        {/* end Mining Buttons */}

        {/* Native EAST wallet lives on /wallet (default network: East) */}
        <a
          href="/wallet"
          className="flex items-center justify-between w-full px-4 py-3 rounded-2xl border border-primary/20 bg-primary/5 hover:bg-primary/10 transition-colors"
        >
          <div className="text-left">
            <p className="text-[9px] font-black uppercase tracking-[0.25em] text-white/40">EAST Wallet</p>
            <p className="text-sm font-bold text-white mt-0.5">Open Wallet · Network: East</p>
          </div>
          <span className="text-[10px] font-black uppercase tracking-wider text-primary">Wallet →</span>
        </a>

        {/* Recent EAST Transactions */}
        <button
          onClick={() => setActivityCollapsed(!activityCollapsed)}
          className="flex items-center justify-between w-full px-1 mt-1"
        >
          <p className="text-[9px] font-black uppercase tracking-[0.3em] text-white/30">
            Recent Activity
            {pendingTransactions.length > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 text-amber-400 normal-case tracking-normal font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                {pendingTransactions.length} pending
              </span>
            )}
          </p>
          <ChevronDown className={cn(
            "w-3.5 h-3.5 text-white/30 transition-transform",
            activityCollapsed ? "-rotate-90" : "rotate-0"
          )} />
        </button>
        {!activityCollapsed && (
          <Card className="bg-card/40 border-white/5 w-full rounded-2xl">
            <CardContent className="p-2">
              {txLoading && transactions.length === 0 && pendingTransactions.length === 0 && localActivity.length === 0 ? (
                <p className="text-[10px] text-muted-foreground text-center py-6">Loading transactions...</p>
              ) : transactions.length === 0 && pendingTransactions.length === 0 && localActivity.length === 0 ? (
                <p className="text-[10px] text-muted-foreground text-center py-6">No transactions yet.</p>
              ) : (
                <div className="divide-y divide-white/5 max-h-[400px] overflow-y-auto">
                  {pendingTransactions.map((tx) => {
                    const isOpen = expandedTxId === tx.txHash;
                    return (
                      <div key={tx.txHash} className="px-1.5">
                        <button
                          onClick={() => setExpandedTxId(isOpen ? null : tx.txHash)}
                          className="w-full flex items-center justify-between py-2.5 text-left"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="h-8 w-8 rounded-full flex items-center justify-center shrink-0 bg-amber-500/10">
                              <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-bold capitalize truncate flex items-center gap-1.5">
                                {tx.type}
                                <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 font-black uppercase tracking-wider">Pending</span>
                              </p>
                              <p className="text-[9px] text-muted-foreground font-mono truncate max-w-[140px]">
                                {tx.address ? `${tx.address.slice(0, 8)}...${tx.address.slice(-6)}` : ''}
                              </p>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p className={cn("text-xs font-code font-bold", tx.amount.startsWith('-') ? "text-red-400" : "text-green-400")}>
                              {tx.amount} <span className="text-[9px] text-muted-foreground">EAST</span>
                            </p>
                            <p className="text-[9px] text-amber-400/70">
                              {tx.queuePosition === 1 ? 'Next in line' : `#${tx.queuePosition} in queue`}
                            </p>
                          </div>
                        </button>
                        {isOpen && (
                          <div className="pb-3 px-1 space-y-1.5 -mt-1">
                            <div className="flex items-center justify-between bg-white/[0.03] rounded-lg px-2.5 py-2">
                              <span className="text-[9px] text-muted-foreground font-mono truncate">{tx.txHash}</span>
                              <CopyTxButton text={tx.txHash} />
                            </div>
                            <p className="text-[9px] text-muted-foreground px-0.5">
                              Submitted {tx.submittedAt} · Gas fee {tx.gasFee > 0 ? `${tx.gasFee} EAST` : 'none'} · waiting to be sealed into a block
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  
                  {localActivity
                    .filter((la) => !transactions.some((x) => x.txHash === la.txHash))
                    .filter((la) => !pendingTransactions.some((x) => x.txHash === la.txHash))
                    .map((tx) => (
                    <div key={`loc-${tx.id}`} className="px-1.5">
                      <div className="w-full flex items-center justify-between py-2.5">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="h-8 w-8 rounded-full flex items-center justify-center shrink-0 bg-primary/10">
                            <ArrowUpRight className="w-4 h-4 text-red-400" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-bold capitalize text-white/90">{tx.type} · {tx.status === 'pending' ? 'Pending' : tx.status === 'confirmed' ? 'Confirmed' : tx.status}</p>
                            <p className="text-[9px] text-muted-foreground truncate">{tx.date} · on-chain</p>
                          </div>
                        </div>
                        <p className="text-xs font-bold text-white/80 shrink-0">{tx.amount}</p>
                      </div>
                    </div>
                  ))}
{transactions.map((tx) => {
                    const isOpen = expandedTxId === tx.txHash;
                    return (
                      <div key={tx.id} className="px-1.5">
                        <button
                          onClick={() => setExpandedTxId(isOpen ? null : tx.txHash)}
                          className="w-full flex items-center justify-between py-2.5 text-left"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className={cn(
                              "h-8 w-8 rounded-full flex items-center justify-center shrink-0",
                              tx.type === 'send' ? "bg-red-500/10" : tx.type === 'stake' ? "bg-amber-500/10" : "bg-green-500/10"
                            )}>
                              {tx.type === 'send' ? (
                                <ArrowUpRight className="w-4 h-4 text-red-400" />
                              ) : tx.type === 'stake' ? (
                                <Lock className="w-4 h-4 text-amber-400" />
                              ) : (
                                <ArrowDownLeft className="w-4 h-4 text-green-400" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-bold capitalize truncate">{tx.type}</p>
                              <p className="text-[9px] text-muted-foreground font-mono truncate max-w-[140px]">
                                {tx.address ? `${tx.address.slice(0, 8)}...${tx.address.slice(-6)}` : ''}
                              </p>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p className={cn(
                              "text-xs font-code font-bold",
                              tx.amount.startsWith('-') ? "text-red-400" : "text-green-400"
                            )}>
                              {tx.amount} <span className="text-[9px] text-muted-foreground">{tx.token}</span>
                            </p>
                            <p className="text-[9px] text-muted-foreground">{tx.date}</p>
                          </div>
                        </button>
                        {isOpen && (
                          <div className="pb-3 px-1 space-y-1.5 -mt-1">
                            <div className="flex items-center justify-between bg-white/[0.03] rounded-lg px-2.5 py-2">
                              <span className="text-[9px] text-muted-foreground font-mono truncate">{tx.txHash}</span>
                              <CopyTxButton text={tx.txHash} />
                            </div>
                            <p className="text-[9px] text-muted-foreground px-0.5">
                              Status: <span className="text-green-400 capitalize">{tx.status}</span>
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <p className="text-[9px] text-white/20 uppercase font-black tracking-[0.3em] text-center py-2">
          Protocol: <span className="text-primary">Anchor Protocol Active</span>
        </p>
      </div>


      <FullNodeConsentDialog
        open={fullNodeOpen}
        onOpenChange={setFullNodeOpen}
        onConfirm={handleEnableFullNode}
        loading={fullNodeLoading}
      />

      {/* Signature Dialog — mining claim */}
      <SignatureDialog
        open={sigOpen}
        onOpenChange={(v) => { if (!isClaiming) setSigOpen(v); }}
        txType="MINING_CLAIM"
        from="EASTCHAIN"
        to={walletAddress.length > 10 ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : walletAddress}
        amount={MINING_REWARD * getTierFromStaked(user?.stakedAmount || 0).boost}
        gasFee={0}
        onConfirm={handleClaim}
        loading={isClaiming}
      />
    </div>
  );
}
