"use client"

import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Activity, Zap, RefreshCcw, MessageSquare, Archive, ShieldCheck, Cpu, CheckCircle2, Radio } from 'lucide-react';
import { claimMiningReward, initiateConsensusRecovery, performRollingArchive, getChainState } from '@/actions/mining-actions';
import { useToast } from '@/hooks/use-toast';
import { getTierFromStaked } from '@/lib/ledger';
import { cn } from '@/lib/utils';
import { useTelegram } from '@/hooks/use-telegram';
import { getLightNodeClient, type LightNodeState } from '@/lib/lightnode/client';

const MIN_VERIFIED_HEADERS = 5;
const MIN_PARTICIPATION_SECONDS = 120;

export function MiningDashboard() {
  const { userId, user, initData, loading: userLoading, refreshUser } = useTelegram();
  const [nodeState, setNodeState] = useState<LightNodeState | null>(null);
  const [isClaiming, setIsClaiming] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);
  const [isRolling, setIsRolling] = useState(false);
  const [networkStatus, setNetworkStatus] = useState<string>('active');
  const [blockCount, setBlockCount] = useState(0);
  const { toast } = useToast();

  // Subscribe to the real Light Node relay — this is the actual source of
  // truth for mining eligibility now (5 headers verified + 120s connected),
  // replacing the old fake client-side progress timer.
  useEffect(() => {
    const client = getLightNodeClient();
    const unsub = client.subscribe(setNodeState);
    return () => { unsub(); };
  }, []);

  useEffect(() => {
    async function fetchChainState() {
      try {
        const state = await getChainState();
        setNetworkStatus(state.status || 'active');
        setBlockCount(state.blockCount || 0);
      } catch {}
    }
    fetchChainState();
    const interval = setInterval(fetchChainState, 30_000);
    return () => clearInterval(interval);
  }, []);

  const isNetworkHalted = networkStatus === 'halted';
  const isNetworkRecovering = networkStatus === 'recovering';
  const tier = getTierFromStaked(user?.stakedAmount || 0);

  const isConnecting = nodeState?.connectionStatus === 'connecting';
  const isConnected = nodeState?.connectionStatus === 'connected';
  const isNodeActive = isConnecting || isConnected;
  const isReadyToClaim = nodeState?.eligible === true;

  // Progress reflects the SLOWER of the two real requirements — both the
  // header count and the 120s participation clock must complete, so the
  // bar only fills as fast as whichever one is lagging.
  const headerPct = nodeState ? Math.min(100, (nodeState.verifiedHeaderCount / MIN_VERIFIED_HEADERS) * 100) : 0;
  const timePct = nodeState ? Math.min(100, (nodeState.participationSeconds / MIN_PARTICIPATION_SECONDS) * 100) : 0;
  const progress = isReadyToClaim ? 100 : Math.min(headerPct, timePct);

  const handleInitiateMining = () => {
    if (isNetworkHalted || isNodeActive) return;
    getLightNodeClient().connect();
  };

  const handleClaimReward = async () => {
    if (isClaiming || !isReadyToClaim) return;
    setIsClaiming(true);
    try {
      const result = await claimMiningReward(userId, initData);
      if (result.success) {
        toast({ title: "Block Verified", description: `Ledger synced. Reward: +${result.reward} EAST.` });
        getLightNodeClient().markClaimed(String(result.epoch ?? Date.now()));
        refreshUser();
      } else {
        toast({ variant: "destructive", title: "Protocol Rejected", description: result.error });
      }
    } catch {
      toast({ variant: "destructive", title: "Network Error", description: "Failed to reach ledger. Check your connection." });
    } finally {
      setIsClaiming(false);
    }
  };

  const handleConsensusRecovery = async () => {
    setIsRecovering(true);
    const result = await initiateConsensusRecovery(userId, initData);
    if (result.success) {
      toast({ title: "Consensus Recovered", description: `Ledger restored at timestamp ${result.resumedAt}.` });
      setNetworkStatus('active');
    } else {
      toast({ variant: "destructive", title: "Recovery Failed", description: result.error });
    }
    setIsRecovering(false);
  };

  const handleManualRolling = async () => {
    if (blockCount < 10) {
      toast({ description: "Requires more data blocks to archive." });
      return;
    }
    setIsRolling(true);
    const result = await performRollingArchive(blockCount - 5, userId, initData);
    if (result.success) {
      toast({ title: "Archival Complete", description: `${result.count} blocks moved to Cold Storage.` });
    } else {
      toast({ variant: "destructive", title: "Archive Failed", description: result.error });
    }
    setIsRolling(false);
  };

  return (
    <div className="px-6 -mt-12 relative z-20 space-y-8">
      <Card className="glass-card overflow-hidden border-white/5">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-primary/50 to-transparent"></div>
        <CardContent className="p-8">
          <div className="flex justify-between items-start">
            <div className="space-y-4">
              <div className="flex items-center space-x-2">
                <ShieldCheck className="w-3.5 h-3.5 text-primary opacity-80" />
                <p className="text-white/40 text-[10px] font-black uppercase tracking-[0.2em]">Verified Assets</p>
              </div>
              <div className="space-y-1">
                <h3 className="text-4xl font-code font-bold premium-gradient-text tracking-tighter">
                  {userLoading ? "---" : (user?.balance || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  <span className="text-primary text-xs ml-2 font-black italic">EAST</span>
                </h3>
              </div>
              <div className="flex items-center space-x-3 pt-2">
                <Badge className="bg-white/10 hover:bg-white/20 text-white border-white/5 rounded-md px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest">
                  {tier.name}
                </Badge>
                <div className="flex items-center space-x-1.5 text-primary">
                  <Cpu className="w-3 h-3" />
                  <span className="text-[10px] font-black uppercase tracking-tighter">{tier.boost}x Efficiency</span>
                </div>
              </div>
            </div>
            <div className={cn(
              "p-4 rounded-2xl transition-all duration-700",
              isNodeActive ? "bg-primary/20 scale-110 glow-pulse" : isReadyToClaim ? "bg-green-500/20" : "bg-white/5"
            )}>
              {isReadyToClaim
                ? <CheckCircle2 className="w-6 h-6 text-green-500" />
                : <Zap className={cn("w-6 h-6 transition-colors duration-500", isNodeActive ? "text-primary fill-primary" : "text-white/20")} />
              }
            </div>
          </div>

          <div className="mt-10 space-y-3">
            <div className="flex justify-between items-end text-[9px] font-black uppercase tracking-[0.15em]">
              <span className="text-white/30">Node Participation</span>
              <span className={cn(
                "transition-colors",
                isNetworkRecovering ? "text-yellow-500" : isNetworkHalted ? "text-red-500" : isReadyToClaim ? "text-green-500" : "text-primary"
              )}>
                {isNetworkRecovering ? "Syncing..." : isNetworkHalted ? "Interrupted" : isReadyToClaim ? "Complete" :
                  isConnecting ? "Connecting Node..." :
                  isConnected ? `${nodeState?.verifiedHeaderCount ?? 0}/${MIN_VERIFIED_HEADERS} headers · ${nodeState?.participationSeconds ?? 0}/${MIN_PARTICIPATION_SECONDS}s` :
                  "Standby"}
              </span>
            </div>
            <div className="relative h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
              <div
                className={cn(
                  "absolute top-0 left-0 h-full transition-all duration-300 ease-out",
                  isReadyToClaim ? "bg-green-500" : isNodeActive ? "bg-primary" : "bg-white/20"
                )}
                style={{ width: `${progress}%` }}
              />
            </div>
            {isConnected && !isReadyToClaim && (
              <p className="text-[9px] text-white/30 font-medium normal-case">
                Stay connected — closing the app resets your participation timer.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {isNetworkRecovering ? (
          <div className="space-y-4">
            <div className="bg-yellow-500/5 border border-yellow-500/10 p-5 rounded-2xl backdrop-blur-md">
              <div className="flex items-center space-x-3 mb-2">
                <MessageSquare className="w-4 h-4 text-yellow-500" />
                <p className="text-[11px] font-black text-yellow-500 uppercase tracking-widest">Gossip Protocol Active</p>
              </div>
              <p className="text-[10px] text-white/50 leading-relaxed font-medium uppercase">
                Consensus violation detected. Validators are voting for a safe rollback.
              </p>
            </div>
            <Button
              onClick={handleConsensusRecovery}
              disabled={isRecovering}
              className="w-full h-16 bg-yellow-600 hover:bg-yellow-500 text-white rounded-2xl font-headline font-bold text-sm tracking-widest uppercase shadow-2xl shadow-yellow-900/40"
            >
              <RefreshCcw className={cn("w-5 h-5 mr-3", isRecovering && "animate-spin")} />
              Sign Consensus Recovery
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {isReadyToClaim ? (
              <Button
                onClick={handleClaimReward}
                disabled={isClaiming}
                className="w-full h-20 rounded-2xl font-headline font-black text-sm tracking-[0.25em] uppercase transition-all duration-500 border-0 shadow-2xl bg-green-600 text-white hover:bg-green-500 shadow-green-900/40"
              >
                <div className="flex items-center space-x-3">
                  {isClaiming ? <RefreshCcw className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
                  <span>{isClaiming ? "Broadcasting..." : "Claim Mining Reward"}</span>
                </div>
              </Button>
            ) : (
              <Button
                disabled={isNetworkHalted || isNodeActive}
                onClick={handleInitiateMining}
                className={cn(
                  "w-full h-20 rounded-2xl font-headline font-black text-sm tracking-[0.25em] uppercase transition-all duration-500 border-0 shadow-2xl",
                  isNodeActive ? "bg-white/5 text-white/20 cursor-wait" : "bg-primary text-white hover:opacity-90 shadow-primary/30"
                )}
              >
                <div className="flex items-center space-x-3">
                  {isConnecting ? <Radio className="w-5 h-5 animate-pulse" /> : isConnected ? <Activity className="w-5 h-5 animate-pulse" /> : <Zap className="w-5 h-5 fill-white" />}
                  <span>{isNetworkHalted ? "Network Locked" : isConnecting ? "Connecting Node..." : isConnected ? "Node Active — Verifying..." : "Initiate Mining Cycle"}</span>
                </div>
              </Button>
            )}
            {user?.isFounder && (
              <div className="grid grid-cols-2 gap-4">
                <Button
                  variant="outline"
                  onClick={handleManualRolling}
                  disabled={isRolling || isNodeActive || isClaiming}
                  className="h-14 rounded-2xl border-white/5 bg-white/5 hover:bg-white/10 text-white/40 text-[10px] font-black uppercase tracking-widest"
                >
                  <Archive className="w-4 h-4 mr-2 opacity-50" />
                  Prune L2
                </Button>
                <Button
                  variant="outline"
                  disabled
                  className="h-14 rounded-2xl border-white/5 bg-white/5 text-white/20 text-[10px] font-black uppercase tracking-widest cursor-not-allowed"
                >
                  Audit Chain
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      <footer className="text-center pb-10">
        <p className="text-[9px] text-white/20 uppercase font-black tracking-[0.4em]">
          Protocol Status: <span className="text-primary">Anchor Protocol Active</span>
        </p>
      </footer>
    </div>
  );
}
