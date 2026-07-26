"use client";

import { useEffect, useState } from "react";
import { Lock, Unlock, Calendar, TrendingUp, Clock, Loader2, Hourglass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useTelegram } from "@/hooks/use-telegram";
import { claimVestedTokens } from "@/actions/mining-actions";
import { SignatureDialog } from "@/components/SignatureDialog";

interface VestingData {
  label: string;
  total_amount: number;
  unlocked_amount: number;
  monthly_release: number;
  start_date: string;
  next_unlock: string;
  months_released: number;
  total_months: number;
  cliff_months: number;
  is_completed: boolean;
}

// Fallbacks only for the brief window before /api/vesting responds —
// must match FOUNDER_VESTING_TOTAL/CLIFF_MONTHS/RELEASE_MONTHS in
// genesis-reset-actions.ts. Once `vesting` loads, everything below reads
// from the live row instead — no separate "genesis unlock %" anymore,
// because there isn't one: the whole allocation is cliff-gated.
const FALLBACK_TOTAL = 50_000_000;
const FALLBACK_CLIFF_MONTHS = 12;
const FALLBACK_RELEASE_MONTHS = 36;

export default function VestingContent() {
  const [vesting, setVesting] = useState<VestingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [sigOpen, setSigOpen] = useState(false);
  const { toast } = useToast();
  const { userId, initData, user, refreshUser } = useTelegram();

  const refetchVesting = () => {
    fetch("/api/vesting")
      .then(r => r.json())
      .then(d => { setVesting(d.vesting); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => { refetchVesting(); }, []);

  const handleClaimRequest = () => {
    if (!userId) return;
    setSigOpen(true);
  };

  const handleClaim = async () => {
    if (!userId) return;
    setClaiming(true);
    try {
      const res = await claimVestedTokens(userId, initData);
      if (res.success) {
        toast({ title: "Vesting Claimed", description: `+${res.reward ?? res.released ?? ''} EAST released on-chain.` });
        refetchVesting();
        refreshUser();
      } else {
        toast({ variant: "destructive", title: "Claim Failed", description: res.error });
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err?.message || "Request failed" });
    } finally {
      setClaiming(false);
      setSigOpen(false);
    }
  };

  const totalAmount = vesting?.total_amount ?? FALLBACK_TOTAL;
  const cliffMonths = vesting?.cliff_months ?? FALLBACK_CLIFF_MONTHS;
  const totalMonths = vesting?.total_months ?? FALLBACK_RELEASE_MONTHS;
  const unlockedAmount = vesting?.unlocked_amount ?? 0;
  const monthsReleased = vesting?.months_released ?? 0;

  // Still inside the cliff: nothing has unlocked yet by design — no
  // separate "genesis %" carve-out anymore. next_unlock during the cliff
  // points at the cliff end date (set by genesis-reset-actions.ts).
  const inCliff = monthsReleased === 0 && unlockedAmount === 0 && !vesting?.is_completed;

  const canClaim = !!user?.isFounder && !!vesting && !vesting.is_completed
    && new Date(vesting.next_unlock).getTime() <= Date.now();

  const unlockedPct = totalAmount > 0 ? Math.round((unlockedAmount / totalAmount) * 100) : 0;

  const nextUnlock = vesting ? new Date(vesting.next_unlock) : null;
  const daysLeft   = nextUnlock
    ? Math.max(0, Math.ceil((nextUnlock.getTime() - Date.now()) / 86400000))
    : cliffMonths * 30;

  if (loading) {
    return (
      <div className="p-4 space-y-3">
        {[1,2,3].map(i => (
          <div key={i} className="h-20 rounded-xl bg-white/[0.04] animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3">

      {/* Header */}
      <div className="flex items-center gap-2 px-1">
        <Lock className="w-4 h-4 text-primary" />
        <span className="text-[10px] font-black uppercase tracking-widest text-white/40">
          Founder Vesting Schedule
        </span>
      </div>

      {/* Summary card */}
      <div className="bg-primary/10 border border-primary/20 rounded-2xl p-4 space-y-3">
        <div className="flex justify-between items-start">
          <div>
            <p className="text-[10px] text-white/40 uppercase tracking-wider font-bold">Total Allocation</p>
            <p className="text-xl font-black text-white mt-0.5">
              {totalAmount.toLocaleString()} <span className="text-primary text-sm">EAST</span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-white/40 uppercase tracking-wider font-bold">Unlocked</p>
            <p className="text-xl font-black text-primary mt-0.5">{unlockedPct}%</p>
          </div>
        </div>

        {/* Progress bar */}
        <div>
          <div className="h-2 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-700"
              style={{ width: `${unlockedPct}%` }}
            />
          </div>
          <div className="flex justify-between mt-1.5">
            <span className="text-[9px] text-white/30">0</span>
            <span className="text-[9px] text-white/30">{totalAmount.toLocaleString()} EAST</span>
          </div>
        </div>
      </div>

      {/* Cliff notice — nothing unlocks until this passes, no genesis carve-out */}
      {inCliff && (
        <div className="bg-yellow-400/10 border border-yellow-400/20 rounded-xl p-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-yellow-400/20 flex items-center justify-center shrink-0">
            <Hourglass className="w-4 h-4 text-yellow-400" />
          </div>
          <div className="flex-1">
            <p className="text-[10px] text-white/40 uppercase tracking-wider font-bold">Cliff Period</p>
            <p className="text-sm font-black text-white">{cliffMonths}-month cliff — 0 EAST unlocked</p>
            <p className="text-[9px] text-yellow-400/80 font-bold">
              {nextUnlock ? `Ends ${nextUnlock.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : `No unlocks for ${cliffMonths} months from genesis`}
            </p>
          </div>
        </div>
      )}

      {/* Vesting pool remaining */}
      <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-3 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center shrink-0">
          <Lock className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1">
          <p className="text-[10px] text-white/40 uppercase tracking-wider font-bold">Locked</p>
          <p className="text-sm font-black text-white">{(totalAmount - unlockedAmount).toLocaleString()} EAST</p>
          <p className="text-[9px] text-white/40 font-bold">{cliffMonths}mo cliff, then {totalMonths} months linear release</p>
        </div>
        <span className="text-[10px] font-black text-primary bg-primary/10 px-2 py-1 rounded-lg">{100 - unlockedPct}%</span>
      </div>

      {unlockedAmount > 0 && (
        <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-green-500/20 flex items-center justify-center shrink-0">
            <Unlock className="w-4 h-4 text-green-400" />
          </div>
          <div className="flex-1">
            <p className="text-[10px] text-white/40 uppercase tracking-wider font-bold">Unlocked So Far</p>
            <p className="text-sm font-black text-white">{unlockedAmount.toLocaleString()} EAST</p>
            <p className="text-[9px] text-green-400 font-bold">{monthsReleased} / {totalMonths} monthly releases claimed</p>
          </div>
          <span className="text-[10px] font-black text-green-400 bg-green-400/10 px-2 py-1 rounded-lg">{unlockedPct}%</span>
        </div>
      )}

      {/* Monthly release info */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingUp className="w-3 h-3 text-primary" />
            <p className="text-[9px] text-white/40 uppercase tracking-wider font-bold">Monthly Release</p>
          </div>
          <p className="text-sm font-black text-white">
            {vesting?.monthly_release ? Math.round(vesting.monthly_release).toLocaleString() : Math.round(totalAmount / totalMonths).toLocaleString()}
          </p>
          <p className="text-[9px] text-white/30">EAST / month (after cliff)</p>
        </div>

        <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Clock className="w-3 h-3 text-yellow-400" />
            <p className="text-[9px] text-white/40 uppercase tracking-wider font-bold">Next Unlock</p>
          </div>
          <p className="text-sm font-black text-white">{daysLeft} days</p>
          <p className="text-[9px] text-white/30">
            {nextUnlock ? nextUnlock.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
          </p>
        </div>
      </div>

      {/* Month timeline — post-cliff release months only */}
      <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-3">
        <div className="flex items-center gap-1.5 mb-3">
          <Calendar className="w-3 h-3 text-primary" />
          <p className="text-[9px] text-white/40 uppercase tracking-wider font-bold">
            {cliffMonths}mo Cliff + {totalMonths} Month Release Timeline
          </p>
        </div>
        <div className="grid grid-cols-6 gap-1.5">
          {Array.from({ length: totalMonths }, (_, i) => {
            const isDone   = i < monthsReleased;
            const isCurrent = i === monthsReleased && !inCliff;
            return (
              <div
                key={i}
                className={`rounded-lg p-1.5 text-center border ${
                  isDone
                    ? "bg-primary/20 border-primary/30"
                    : isCurrent
                    ? "bg-yellow-400/10 border-yellow-400/30"
                    : "bg-white/[0.03] border-white/[0.06]"
                }`}
              >
                <p className={`text-[8px] font-black ${
                  isDone ? "text-primary" : isCurrent ? "text-yellow-400" : "text-white/20"
                }`}>
                  M{i + 1}
                </p>
                {isDone && <p className="text-[6px] text-primary/70 mt-0.5">✓</p>}
                {isCurrent && <p className="text-[6px] text-yellow-400/70 mt-0.5">▶</p>}
              </div>
            );
          })}
        </div>
        <p className="text-[9px] text-white/30 mt-2 text-center">
          {monthsReleased} / {totalMonths} months released{inCliff ? ` — still in ${cliffMonths}mo cliff` : ''}
        </p>
      </div>

      {user?.isFounder && (
        <Button
          onClick={handleClaimRequest}
          disabled={!canClaim || claiming}
          className="w-full rounded-xl font-black"
        >
          {claiming ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Claiming…</>
          ) : canClaim ? (
            `Claim ${vesting?.monthly_release ? Math.round(vesting.monthly_release).toLocaleString() : ''} EAST`
          ) : inCliff ? (
            `Locked — ${cliffMonths}mo Cliff`
          ) : (
            "Next Unlock Not Yet Available"
          )}
        </Button>
      )}

      <p className="text-[9px] text-white/20 text-center px-4">
        Vesting enforced on-chain via EASTCHAIN Anchor Protocol — gas paid in EAST
      </p>

      {/* Signature Dialog — vesting claim */}
      <SignatureDialog
        open={sigOpen}
        onOpenChange={(v) => { if (!claiming) setSigOpen(v); }}
        txType="VESTING_CLAIM"
        from="Vesting Pool"
        to={user?.walletAddress ? `${user.walletAddress.slice(0, 6)}...${user.walletAddress.slice(-4)}` : "Founder Wallet"}
        amount={vesting?.monthly_release ?? 0}
        gasFee={0}
        onConfirm={handleClaim}
        loading={claiming}
      />
    </div>
  );
}
