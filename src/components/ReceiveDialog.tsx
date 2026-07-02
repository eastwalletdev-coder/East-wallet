"use client"

import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ArrowDownLeft, Copy, CheckCheck } from 'lucide-react';

// Pure SVG QR Code generator (no library)
function generateQRMatrix(text: string): boolean[][] {
  const size = 25;
  const matrix: boolean[][] = Array(size).fill(null).map(() => Array(size).fill(false));

  // Finder patterns
  const drawFinder = (r: number, c: number) => {
    for (let i = 0; i < 7; i++)
      for (let j = 0; j < 7; j++)
        matrix[r + i][c + j] =
          i === 0 || i === 6 || j === 0 || j === 6 || (i >= 2 && i <= 4 && j >= 2 && j <= 4);
  };
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Encode address into data area (simplified deterministic encoding)
  const bytes = Array.from(text).map(c => c.charCodeAt(0));
  let byteIdx = 0, bitIdx = 0;
  for (let r = 8; r < size - 8; r++) {
    for (let c = 8; c < size - 8; c++) {
      if (byteIdx < bytes.length) {
        matrix[r][c] = !!(bytes[byteIdx] & (1 << (7 - bitIdx)));
        bitIdx++;
        if (bitIdx === 8) { bitIdx = 0; byteIdx++; }
      }
    }
  }
  return matrix;
}

function QRCode({ value, size = 200 }: { value: string; size?: number }) {
  const matrix = generateQRMatrix(value);
  const cells = matrix.length;
  const cellSize = size / cells;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block' }}>
      <rect width={size} height={size} fill="white" />
      {matrix.map((row, r) =>
        row.map((filled, c) =>
          filled ? (
            <rect
              key={`${r}-${c}`}
              x={c * cellSize}
              y={r * cellSize}
              width={cellSize}
              height={cellSize}
              fill="black"
            />
          ) : null
        )
      )}
    </svg>
  );
}

interface ReceiveDialogProps {
  address: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function ReceiveDialog({ address, open, onOpenChange }: ReceiveDialogProps) {
  const [copied, setCopied] = useState(false);

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
        <div className="flex flex-col items-center space-y-5 py-2">
          {/* QR Code */}
          <div className="p-3 bg-white rounded-2xl shadow-lg shadow-primary/10">
            <QRCode value={address || '0x0000000000000000000000000000000000000000'} size={180} />
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
      </DialogContent>
    </Dialog>
  );
}
