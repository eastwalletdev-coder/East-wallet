"use client"

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, ShieldCheck, X } from 'lucide-react';

interface SignatureDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  txType: string;
  from: string;
  to: string;
  amount: number;
  gasFee: number;
  onConfirm: () => Promise<void>;
  loading?: boolean;
}

export function SignatureDialog({
  open, onOpenChange, txType, from, to, amount, gasFee, onConfirm, loading
}: SignatureDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-background border-primary/20 rounded-[2rem] max-w-[360px] p-0 overflow-hidden">
        {/* Header */}
        <div className="px-5 pt-5 pb-4 border-b border-white/5">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-primary" />
              <DialogTitle className="text-white font-black uppercase text-sm tracking-widest">
                Sign Transaction
              </DialogTitle>
            </div>
            <button onClick={() => onOpenChange(false)} className="text-white/30 hover:text-white transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
          <p className="text-[9px] text-white/30 uppercase font-bold">EAST Hybrid Ledger · Secure Channel</p>
        </div>

        {/* TX Type badge */}
        <div className="px-5 pt-4">
          <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-full px-3 py-1">
            <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            <span className="text-primary text-[10px] font-black uppercase tracking-widest">{txType}</span>
          </div>
        </div>

        {/* TX Details */}
        <div className="px-5 py-4 space-y-3">
          <div className="bg-white/[0.03] rounded-2xl p-4 space-y-3">
            <Row label="From" value={from} mono />
            <Row label="To" value={to} mono />
            <div className="border-t border-white/5 pt-3 space-y-2">
              <Row label="Amount" value={`${amount.toLocaleString()} EAST`} highlight />
              <Row label="Gas Fee" value={gasFee > 0 ? `${gasFee} EAST` : 'Free'} />
              <div className="border-t border-white/5 pt-2">
                <Row label="Total" value={`${(amount + gasFee).toLocaleString()} EAST`} highlight bold />
              </div>
            </div>
          </div>

          <p className="text-[9px] text-white/20 text-center leading-relaxed">
            By confirming, this transaction will be broadcast to the EAST hybrid ledger and cannot be reversed.
          </p>
        </div>

        {/* Actions */}
        <div className="px-5 pb-5 grid grid-cols-2 gap-3">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
            className="h-12 rounded-2xl border-white/10 bg-white/5 text-white/50 font-black uppercase text-[10px]"
          >
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            disabled={loading}
            className="h-12 rounded-2xl bg-primary hover:bg-primary/90 text-white font-black uppercase text-[10px] tracking-widest"
          >
            {loading
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : 'Confirm ✓'
            }
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, mono, highlight, bold }: {
  label: string; value: string; mono?: boolean; highlight?: boolean; bold?: boolean;
}) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-white/30 text-[10px] uppercase font-bold">{label}</span>
      <span className={`text-[11px] font-bold ${mono ? 'font-mono' : ''} ${highlight ? 'text-primary' : 'text-white'} ${bold ? 'text-base' : ''}`}>
        {value}
      </span>
    </div>
  );
}
