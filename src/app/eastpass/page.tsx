"use client"

import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Zap, Shield, TrendingUp, Lock, CheckCircle2, Fingerprint, QrCode, Coins, ArrowDownToLine, Clock } from 'lucide-react';
import { EASTPASS_TIERS, getTierFromStaked } from '@/lib/ledger';
import { stakeEast, requestUnstake, claimUnstake } from '@/actions/mining-actions';
import { useToast } from '@/hooks/use-toast';
import { useTelegram } from '@/hooks/use-telegram';
import { generateEastId, getPassStatusLabel, isPassActive } from '@/lib/east-id';
import { SignatureDialog } from '@/components/SignatureDialog';
import { useWallet } from '@/lib/wallet-context';
import { submitChainStake, submitChainTx, useChainTxEnabled } from '@/lib/chain-tx-client';

function formatCountdown(secs: number) {
  if (secs <= 0) return '00:00:00';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export default function EastpassPage() {
  const { toast } = useToast();
  const { userId, user, initData, loading, refreshUser } = useTelegram();
  const { mnemonic, isLocked } = useWallet();
  const [loadingStake, setLoadingStake] = useState(false);
  const [sigOpen, setSigOpen] = useState(false);
  const [pendingTier, setPendingTier] = useState<any>(null);

  // ── Flexible-amount stake widget ──────────────────────────────────
  const [stakeMode, setStakeMode] = useState<'stake' | 'unstake'>('stake');
  const [sliderAmount, setSliderAmount] = useState(0);
  const [widgetSigOpen, setWidgetSigOpen] = useState(false);
  const [widgetLoading, setWidgetLoading] = useState(false);
  const [claimLoading, setClaimLoading] = useState(false);
  const [claimCountdown, setClaimCountdown] = useState(0);

  const availableBalance = user?.balance || 0;
  const pendingUnstake = user?.pendingUnstakeAmount || 0;
  const pendingClaimableAt = user?.pendingUnstakeClaimableAt || 0;
  const widgetMax = stakeMode === 'stake' ? availableBalance : (user?.stakedAmount || 0);

  useEffect(() => {
    setSliderAmount(0);
  }, [stakeMode]);

  useEffect(() => {
    if (pendingUnstake <= 0 || pendingClaimableAt <= 0) { setClaimCountdown(0); return; }
    const tick = () => setClaimCountdown(Math.max(0, Math.ceil((pendingClaimableAt - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [pendingUnstake, pendingClaimableAt]);

  const setPercent = (pct: number) => {
    setSliderAmount(Math.floor(widgetMax * pct) );
  };

  const handleWidgetConfirm = async () => {
    if (sliderAmount <= 0) return;
    setWidgetLoading(true);

    // On-chain path (Hub → validator) when enabled and vault is unlocked
    if (useChainTxEnabled()) {
      if (!mnemonic || isLocked) {
        toast({
          variant: "destructive",
          title: "Vault locked",
          description: "Unlock your self-custody wallet to sign on-chain stake/unstake.",
        });
        setWidgetLoading(false);
        return;
      }
      if (stakeMode === 'stake') {
        const res = await submitChainStake(mnemonic, sliderAmount);
        if (res.success) {
          toast({ title: "On-chain stake submitted", description: `${sliderAmount} EAST (${res.status})` });
          refreshUser();
          setSliderAmount(0);
        } else {
          toast({ variant: "destructive", title: "Stake Failed", description: res.error });
        }
      } else {
        const res = await submitChainTx({
          mnemonic,
          type: "request_unstake",
          amountHuman: sliderAmount,
        });
        if (res.success) {
          toast({ title: "On-chain unstake submitted", description: `${sliderAmount} EAST (${res.status})` });
          refreshUser();
          setSliderAmount(0);
        } else {
          toast({ variant: "destructive", title: "Unstake Failed", description: res.error });
        }
      }
      setWidgetLoading(false);
      setWidgetSigOpen(false);
      return;
    }

    if (stakeMode === 'stake') {
      const res = await stakeEast(userId, sliderAmount, initData);
      if (res.success) {
        toast({ title: "Stake Confirmed", description: `${sliderAmount} EAST staked.` });
        refreshUser();
        setSliderAmount(0);
      } else {
        toast({ variant: "destructive", title: "Stake Failed", description: res.error });
      }
    } else {
      const res = await requestUnstake(userId, sliderAmount, initData);
      if (res.success) {
        toast({ title: "Unstake Requested", description: `${sliderAmount} EAST will be claimable in 24h.` });
        refreshUser();
        setSliderAmount(0);
      } else {
        toast({ variant: "destructive", title: "Unstake Failed", description: res.error });
      }
    }
    setWidgetLoading(false);
    setWidgetSigOpen(false);
  };

  const handleClaimUnstake = async () => {
    setClaimLoading(true);
    const res = await claimUnstake(userId, initData);
    if (res.success) {
      toast({ title: "Claimed", description: `${res.claimed} EAST added to your balance.` });
      refreshUser();
    } else if (res.error?.startsWith('CLAIM_DELAY_ACTIVE')) {
      toast({ variant: "destructive", title: "Still Locked", description: "The 24h claim delay hasn't passed yet." });
    } else {
      toast({ variant: "destructive", title: "Claim Failed", description: res.error });
    }
    setClaimLoading(false);
  };

  const currentStaked = user?.stakedAmount || 0;
  const currentTier = getTierFromStaked(currentStaked);
  const walletAddress = user?.walletAddress || '0x0000000000000000000000000000000000000000';
  const eastId = walletAddress !== '0x...' ? generateEastId(walletAddress) : 'EAST-????-????-????';
  const passLabel = getPassStatusLabel(user?.eastpassTier || 0);
  const passActive = isPassActive(user?.eastpassTier || 0);
  const shortAddress = walletAddress.length > 10
    ? `${walletAddress.substring(0, 6)}...${walletAddress.substring(walletAddress.length - 4)}`
    : walletAddress;

  const handleStakeRequest = (tier: any) => {
    setPendingTier(tier);
    setSigOpen(true);
  };

  const handleStakeConfirm = async () => {
    if (!pendingTier) return;
    setLoadingStake(true);
    const amount = pendingTier.requirement - currentStaked;

    if (useChainTxEnabled()) {
      if (!mnemonic || isLocked) {
        toast({
          variant: "destructive",
          title: "Vault locked",
          description: "Unlock your self-custody wallet to sign on-chain stake.",
        });
        setLoadingStake(false);
        return;
      }
      const res = await submitChainStake(mnemonic, amount);
      if (res.success) {
        toast({ title: "On-chain stake submitted", description: `tx ${res.txHash?.substring(0, 16)}…` });
        refreshUser();
      } else {
        toast({ variant: "destructive", title: "Stake Failed", description: res.error });
      }
      setLoadingStake(false);
      setSigOpen(false);
      setPendingTier(null);
      return;
    }

    const res = await stakeEast(userId, amount, initData);
    if (res.success) {
      toast({ title: "Stake Confirmed", description: `Proof Hash: ${res.proofHash?.substring(0, 16)}...` });
      refreshUser();
    } else {
      toast({ variant: "destructive", title: "Stake Failed", description: res.error });
    }
    setLoadingStake(false);
    setSigOpen(false);
    setPendingTier(null);
  };

  return (
    <div className="flex flex-col gap-4 px-3 py-4 pb-8">
      <header>
        <h1 className="text-white font-extrabold text-xl uppercase tracking-widest">EastPass</h1>
        <p className="text-white/30 text-[10px] uppercase tracking-wider">Digital Identity Protocol</p>
      </header>

      {/* ── EAST ID Card ── */}
      <div className="relative rounded-2xl overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #1a0a2e 0%, #2d1b4e 40%, #0a1628 100%)' }}>
        {/* Subtle grid overlay */}
        <div className="absolute inset-0 opacity-10"
          style={{ backgroundImage: 'linear-gradient(rgba(139,92,246,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(139,92,246,0.3) 1px, transparent 1px)', backgroundSize: '20px 20px' }} />

        <div className="relative p-5">
          {/* Top row */}
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center">
                <Fingerprint className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-[9px] text-primary font-black uppercase tracking-widest">Verified Member</p>
                <p className="text-white font-bold text-sm font-mono">Node {shortAddress}</p>
              </div>
            </div>
            <QrCode className="w-8 h-8 text-white/20" />
          </div>

          {/* EAST ID */}
          <div className="mb-4">
            <p className="text-[8px] text-white/30 uppercase font-bold mb-1">EAST ID</p>
            <p className="text-white font-mono font-bold text-base tracking-widest">{eastId}</p>
          </div>

          {/* Bottom row */}
          <div className="flex items-end justify-between">
            <div>
              <p className="text-[8px] text-white/30 uppercase font-bold mb-1">Pass Status</p>
              <Badge className={`text-[10px] font-black uppercase px-2 py-0.5 ${
                passActive
                  ? 'bg-primary/30 text-primary border-primary/40'
                  : 'bg-white/10 text-white/40 border-white/10'
              }`}>
                {passLabel}
              </Badge>
            </div>
            <div className="text-right">
              <p className="text-[8px] text-white/30 uppercase font-bold mb-1">Valid Thru</p>
              <p className="text-white/60 text-xs font-mono font-bold">Permanent</p>
            </div>
          </div>

          {/* Coin logo bottom left */}
          <div className="mt-4 flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary to-indigo-900 border border-primary/40 flex items-center justify-center">
              <span className="text-white font-black text-[10px]">E</span>
            </div>
            <span className="text-white/20 text-[9px] font-bold uppercase tracking-widest">EAST Protocol</span>
          </div>
        </div>
      </div>

      {/* Tier Selection */}
      <div className="space-y-3">
        <p className="text-white/40 text-[10px] uppercase font-bold px-1">Available Tiers</p>
        {EASTPASS_TIERS.filter(t => t.level > 0).map((tier) => {
          const isCurrent = currentTier.level === tier.level;
          const isHigher = tier.level > currentTier.level;
          const canStake = (user?.balance || 0) >= tier.requirement - currentStaked;
          return (
            <Card key={tier.level} className={`bg-white/[0.03] border-white/5 rounded-2xl overflow-hidden ${isCurrent ? 'ring-1 ring-primary/50' : ''}`}>
              <CardContent className="p-4">
                <div className="flex justify-between items-start mb-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="text-white font-bold">{tier.name}</p>
                      {isCurrent && <CheckCircle2 className="w-4 h-4 text-primary" />}
                    </div>
                    <p className="text-white/30 text-[10px] uppercase font-bold">{tier.requirement} EAST Stake</p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-mono font-bold text-primary">{tier.boost}x</p>
                    <p className="text-[9px] text-white/30 uppercase">Mining Boost</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div className="flex items-center gap-2 text-[10px] text-white/40">
                    <TrendingUp className="w-3 h-3 text-primary" />
                    <span>{tier.apy * 100}% APY</span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-white/40">
                    <Lock className="w-3 h-3 text-primary" />
                    <span>30-Day Lock</span>
                  </div>
                </div>
                {isHigher && (
                  <Button
                    disabled={loadingStake || !canStake}
                    onClick={() => handleStakeRequest(tier)}
                    className="w-full h-10 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 text-[10px] font-black uppercase tracking-widest"
                  >
                    {canStake ? `Upgrade to ${tier.name} (+${tier.requirement - currentStaked} EAST)` : 'Insufficient Balance'}
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* ── Flexible Stake Widget — its own section, separate from tier cards ── */}
      <div className="space-y-3 pt-2">
        <p className="text-white/40 text-[10px] uppercase font-bold px-1">Stake / Unstake EAST</p>

        <Card className="bg-white/[0.03] border-white/5 rounded-2xl overflow-hidden">
          <CardContent className="p-4 space-y-4">
            {/* Active stake summary */}
            <div className="flex items-center justify-between p-3 rounded-xl bg-primary/[0.06] border border-primary/10">
              <div className="flex items-center gap-2">
                <Coins className="w-4 h-4 text-primary" />
                <div>
                  <p className="text-[8px] text-white/30 uppercase font-bold">Active Stake</p>
                  <p className="text-white font-mono font-bold text-sm">{currentStaked.toLocaleString()} EAST</p>
                </div>
              </div>
              <Badge className="text-[9px] font-black uppercase px-2 py-0.5 bg-primary/20 text-primary border-primary/30">
                {currentTier.name}
              </Badge>
            </div>

            {/* Pending unstake / claim */}
            {pendingUnstake > 0 && (
              <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.04] border border-white/10">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-400" />
                  <div>
                    <p className="text-[8px] text-white/30 uppercase font-bold">Pending Unstake</p>
                    <p className="text-white font-mono font-bold text-sm">{pendingUnstake.toLocaleString()} EAST</p>
                  </div>
                </div>
                {claimCountdown > 0 ? (
                  <div className="text-right">
                    <p className="text-[8px] text-white/30 uppercase font-bold">Claimable In</p>
                    <p className="text-amber-400 font-mono font-bold text-xs">{formatCountdown(claimCountdown)}</p>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    disabled={claimLoading}
                    onClick={handleClaimUnstake}
                    className="h-8 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 text-[9px] font-black uppercase tracking-widest"
                  >
                    <ArrowDownToLine className="w-3 h-3 mr-1" /> Claim Now
                  </Button>
                )}
              </div>
            )}

            {/* Stake / Unstake mode toggle */}
            <Tabs value={stakeMode} onValueChange={(v) => setStakeMode(v as 'stake' | 'unstake')}>
              <TabsList className="grid grid-cols-2 w-full bg-white/[0.04] border border-white/5 rounded-xl h-10">
                <TabsTrigger value="stake" className="text-[10px] font-black uppercase tracking-widest data-[state=active]:bg-primary/20 data-[state=active]:text-primary rounded-lg">
                  Stake
                </TabsTrigger>
                <TabsTrigger value="unstake" className="text-[10px] font-black uppercase tracking-widest data-[state=active]:bg-primary/20 data-[state=active]:text-primary rounded-lg">
                  Unstake
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {/* Amount display */}
            <div className="text-center py-2">
              <p className="text-3xl font-mono font-bold text-white">{sliderAmount.toLocaleString()}</p>
              <p className="text-[9px] text-white/30 uppercase font-bold tracking-widest mt-1">
                EAST · {stakeMode === 'stake' ? `Balance: ${availableBalance.toLocaleString()}` : `Staked: ${currentStaked.toLocaleString()}`}
              </p>
            </div>

            {/* Manual slider */}
            <Slider
              value={[sliderAmount]}
              max={Math.max(widgetMax, 1)}
              step={1}
              disabled={widgetMax <= 0}
              onValueChange={(v) => setSliderAmount(v[0])}
              className="py-1"
            />

            {/* Percentage quick-select buttons */}
            <div className="grid grid-cols-4 gap-2">
              {[25, 50, 75, 100].map((pct) => (
                <Button
                  key={pct}
                  variant="outline"
                  disabled={widgetMax <= 0}
                  onClick={() => setPercent(pct / 100)}
                  className="h-9 rounded-xl bg-white/[0.03] border-white/10 text-white/60 hover:bg-primary/10 hover:text-primary hover:border-primary/20 text-[10px] font-black uppercase"
                >
                  {pct}%
                </Button>
              ))}
            </div>

            <Button
              disabled={sliderAmount <= 0 || widgetLoading || sliderAmount > widgetMax}
              onClick={() => setWidgetSigOpen(true)}
              className="w-full h-11 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 text-[10px] font-black uppercase tracking-widest"
            >
              {stakeMode === 'stake' ? `Stake ${sliderAmount.toLocaleString()} EAST` : `Request Unstake ${sliderAmount.toLocaleString()} EAST`}
            </Button>

            {stakeMode === 'unstake' && (
              <p className="text-[9px] text-white/25 uppercase font-bold text-center leading-relaxed">
                Unstaking takes effect immediately. Funds are claimable after a 24h delay.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="p-4 bg-white/[0.02] border border-dashed border-white/10 rounded-2xl">
        <div className="flex items-start gap-3">
          <Shield className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <p className="text-[9px] text-white/30 leading-relaxed uppercase font-bold">
            EastPass staking is governed by the Ledger Layer (L2). Every stake creates a permanent cryptographic proof on-chain. Assets cannot be withdrawn before the lock period ends.
          </p>
        </div>
      </div>

      {/* Flexible Stake Widget — Signature Dialog */}
      <SignatureDialog
        open={widgetSigOpen}
        onOpenChange={setWidgetSigOpen}
        txType={stakeMode === 'stake' ? 'STAKE' : 'UNSTAKE'}
        from={stakeMode === 'stake' ? shortAddress : 'Staking Pool'}
        to={stakeMode === 'stake' ? 'Staking Pool' : shortAddress}
        amount={sliderAmount}
        gasFee={0}
        onConfirm={handleWidgetConfirm}
        loading={widgetLoading}
      />

      {/* Signature Dialog */}
      <SignatureDialog
        open={sigOpen}
        onOpenChange={setSigOpen}
        txType="STAKE"
        from={shortAddress}
        to="Staking Pool"
        amount={pendingTier ? pendingTier.requirement - currentStaked : 0}
        gasFee={0}
        onConfirm={handleStakeConfirm}
        loading={loadingStake}
      />
    </div>
  );
}
