"use client"

import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Copy, CheckCheck, ShieldCheck } from 'lucide-react';

interface TransactionApprovalDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  actionLabel: string;      // e.g. "send 0.5 ETH"
  to: string;                // truncated, shown
  toFull: string;            // full address, copied
  network: string;           // "Ethereum", "BNB Smart Chain", "Solana", ...
  amountLabel: string;       // "0.5 ETH"
  estimatedFeeLabel: string; // "~0.000021 ETH (~$0.05)" or "—"
  onApprove: () => Promise<void>;
  approving?: boolean;
}

export function TransactionApprovalDialog({
  open, onOpenChange, actionLabel, to, toFull, network, amountLabel, estimatedFeeLabel, onApprove, approving,
}: TransactionApprovalDialogProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(toFull); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { /* clipboard unavailable */ }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!approving) onOpenChange(v); }}>
      <DialogContent className="bg-[#0B0F1A] border-white/10 rounded-[2rem] max-w-[380px] p-6">
        <div className="text-center space-y-2 mb-6 mt-1">
          <DialogTitle className="text-white font-bold text-xl">Approve Transaction</DialogTitle>
          <p className="text-sm text-white/50 leading-relaxed px-2">
            EASTCHAIN Wallet wants your permission to {actionLabel}.
          </p>
        </div>

        <div className="space-y-3 mb-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-white/40">To</span>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm text-white">{to}</span>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 text-primary border border-primary/40 rounded-full px-2 py-0.5 text-xs hover:bg-primary/10 transition-colors"
              >
                {copied ? <CheckCheck className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-white/40">Network</span>
            <span className="text-sm font-semibold text-white">{network}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-white/40">Estimated Fee</span>
            <span className="text-sm font-semibold text-white">{estimatedFeeLabel}</span>
          </div>
        </div>

        <div className="border border-white/10 rounded-2xl px-4 py-3 mb-6">
          <p className="text-sm font-semibold text-white">{amountLabel}</p>
          <p className="text-xs text-white/40 mt-0.5 font-mono break-all">{toFull}</p>
        </div>

        <Button
          onClick={onApprove}
          disabled={approving}
          className="w-full h-14 rounded-2xl bg-primary hover:bg-primary/90 text-white font-bold text-base"
        >
          {approving ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Approve'}
        </Button>

        <p className="text-[10px] text-white/25 text-center mt-4 flex items-center justify-center gap-1.5">
          <ShieldCheck className="w-3 h-3" /> Secured locally on your device — EASTCHAIN Self-Custody
        </p>
      </DialogContent>
    </Dialog>
  );
}
