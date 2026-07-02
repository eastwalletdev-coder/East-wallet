"use client"

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Zap, Shield, TrendingUp, Lock, CheckCircle2, Fingerprint, QrCode } from 'lucide-react';
import { EASTPASS_TIERS, getTierFromStaked } from '@/lib/ledger';
import { stakeEast } from '@/actions/mining-actions';
import { useToast } from '@/hooks/use-toast';
import { useTelegram } from '@/hooks/use-telegram';
import { generateEastId, getPassStatusLabel, isPassActive } from '@/lib/east-id';
import { SignatureDialog } from '@/components/SignatureDialog';

export default function EastpassPage() {
  const { toast } = useToast();
  const { userId, user, initData, loading, refreshUser } = useTelegram();
  const [loadingStake, setLoadingStake] = useState(false);
  const [sigOpen, setSigOpen] = useState(false);
  const [pendingTier, setPendingTier] = useState<any>(null);

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
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary to-purple-800 border border-primary/40 flex items-center justify-center">
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

      <div className="p-4 bg-white/[0.02] border border-dashed border-white/10 rounded-2xl">
        <div className="flex items-start gap-3">
          <Shield className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <p className="text-[9px] text-white/30 leading-relaxed uppercase font-bold">
            EastPass staking is governed by the Ledger Layer (L2). Every stake creates a permanent cryptographic proof on-chain. Assets cannot be withdrawn before the lock period ends.
          </p>
        </div>
      </div>

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
