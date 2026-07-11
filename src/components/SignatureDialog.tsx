"use client"

import { useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, ShieldCheck, Copy, Check } from 'lucide-react';

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

/** Small inline "copy this text" affordance for address rows. Silently does
 *  nothing if the value doesn't look worth copying (e.g. "Staking Pool"). */
function CopyChip({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const looksCopyable = /^0x[0-9a-fA-F]+$/.test(text) || text.length > 20;
  if (!looksCopyable) return null;

  const handleCopy = async () => {
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
      type="button"
      onClick={handleCopy}
      className="text-white/30 hover:text-primary transition-colors shrink-0"
    >
      {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

function truncateMid(v: string): string {
  if (!v.startsWith('0x') || v.length <= 14) return v;
  return `${v.slice(0, 6)}...${v.slice(-4)}`;
}

export function SignatureDialog({
  open, onOpenChange, txType, from, to, amount, gasFee, onConfirm, loading
}: SignatureDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#0a0a12] border-white/10 rounded-[2rem] max-w-[380px] p-6">
        <div className="space-y-5">
          <div className="text-center space-y-2 px-2 pt-2">
            <h2 className="text-white text-xl font-bold">Approve Transaction</h2>
            <p className="text-white/50 text-sm leading-relaxed">
              EASTCHAIN wants your permission to approve the following {txType.toLowerCase()} transaction.
            </p>
          </div>

          <div className="space-y-3 pt-1">
            <div className="flex items-center justify-between">
              <span className="text-white/40 text-sm">From</span>
              <div className="flex items-center gap-2">
                <span className="text-white font-mono text-sm">{truncateMid(from)}</span>
                <CopyChip text={from} />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-white/40 text-sm">To</span>
              <div className="flex items-center gap-2">
                <span className="text-white font-mono text-sm">{truncateMid(to)}</span>
                <CopyChip text={to} />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-white/40 text-sm">Network</span>
              <span className="text-white font-bold text-sm">EASTCHAIN</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-white/40 text-sm">Estimated fee</span>
              <span className="text-white font-bold text-sm">{gasFee > 0 ? `${gasFee} EAST` : 'Free'}</span>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 px-4 py-3 flex items-center justify-between">
            <span className="text-white font-mono text-sm">{amount.toLocaleString()} EAST</span>
            <span className="text-white/40 text-xs">Total: {(amount + gasFee).toLocaleString()} EAST</span>
          </div>

          <p className="text-[9px] text-white/20 text-center leading-relaxed px-2">
            By approving, this transaction will be broadcast to the EAST hybrid ledger and cannot be reversed.
          </p>

          <Button
            onClick={onConfirm}
            disabled={loading}
            className="w-full h-12 rounded-2xl bg-primary hover:bg-primary/90 text-white font-black uppercase text-[10px] tracking-widest"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            {loading ? 'Broadcasting...' : 'Approve'}
          </Button>

          <div className="flex items-center justify-center gap-1.5 text-white/30 text-[11px]">
            <ShieldCheck className="w-3.5 h-3.5" />
            Secured by EASTCHAIN
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
