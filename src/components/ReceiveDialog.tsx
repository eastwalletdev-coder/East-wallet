"use client"

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ArrowDownLeft, Copy, CheckCheck, AlertCircle } from 'lucide-react';
import QRCodeLib from 'qrcode';

// FIXED: previously a hand-rolled "QR-looking" SVG matrix that didn't
// implement the actual QR spec (no Reed-Solomon error correction, no
// real data encoding) — it LOOKED like a QR code but no scanner could
// actually read it. Replaced with the `qrcode` library, which generates
// spec-compliant, genuinely scannable codes.
function QRCode({ value, size = 200 }: { value: string; size?: number }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCodeLib.toDataURL(value, { width: size, margin: 1, errorCorrectionLevel: 'M' })
      .then((url) => { if (!cancelled) setDataUrl(url); })
      .catch((err) => console.error('[ReceiveDialog] QR generation failed:', err));
    return () => { cancelled = true; };
  }, [value, size]);

  if (!dataUrl) {
    return <div style={{ width: size, height: size }} className="animate-pulse bg-gray-200 rounded-lg" />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={dataUrl} width={size} height={size} alt="Wallet address QR code" />;
}

interface ReceiveDialogProps {
  address: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function ReceiveDialog({ address, open, onOpenChange }: ReceiveDialogProps) {
  const [copied, setCopied] = useState(false);

  // FIXED: previously fell back to a literal "0x..." placeholder string
  // when no real address was available, which got silently encoded into
  // a (fake) QR code — anyone scanning it would send funds to a garbage
  // address. Now we detect the missing-address case explicitly and show
  // a clear message instead of a QR that looks valid but isn't.
  const hasRealAddress = !!address && address !== '0x...' && /^0x[0-9a-fA-F]{40}$/.test(address);

  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(address); }
    catch {
      const el = document.createElement('textarea');
      el.value = address;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" className="flex-1 h-11 rounded-xl bg-primary border-primary text-white font-bold text-[10px] uppercase hover:bg-primary/80 hover:text-white">
          <ArrowDownLeft className="w-4 h-4 mr-2" /> Receive
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-background border-primary/20 rounded-[2rem] max-w-[380px]">
        <DialogHeader>
          <DialogTitle className="font-headline uppercase">Receive</DialogTitle>
        </DialogHeader>

        {!hasRealAddress ? (
          <div className="flex flex-col items-center space-y-4 py-8 px-4 text-center">
            <AlertCircle className="w-10 h-10 text-amber-500" />
            <p className="text-sm font-semibold">Wallet not set up yet</p>
            <p className="text-xs text-muted-foreground">
              No address found for this chain. Create or unlock your wallet first, then come back to receive funds.
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center space-y-5 py-2">
            {/* QR Code */}
            <div className="p-3 bg-white rounded-2xl shadow-lg shadow-primary/10">
              <QRCode value={address} size={180} />
            </div>

            {/* Address */}
            <div className="w-full bg-primary/5 border border-primary/20 rounded-xl p-4">
              <p className="text-[9px] text-primary font-black uppercase text-center mb-2 tracking-widest">Your Wallet Address</p>
              <p className="font-mono text-[11px] text-center break-all text-foreground/80 leading-relaxed">{address}</p>
            </div>

            <Button
              onClick={handleCopy}
              variant="default"
              className="w-full h-12 bg-primary/20 text-primary hover:bg-primary/30 border border-primary/20 rounded-2xl font-black uppercase"
            >
              {copied ? <CheckCheck className="w-4 h-4 mr-2 text-green-400" /> : <Copy className="w-4 h-4 mr-2" />}
              {copied ? 'Copied!' : 'Copy Address'}
            </Button>

            <p className="text-[9px] text-muted-foreground text-center opacity-60 leading-relaxed">
              Only send compatible assets to this address.<br />Wrong network may result in permanent loss.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
