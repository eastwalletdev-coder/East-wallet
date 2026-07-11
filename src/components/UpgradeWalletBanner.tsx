"use client"

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ShieldAlert, X } from 'lucide-react';

interface UpgradeWalletBannerProps {
  onUpgradeClick: () => void;
}

export function UpgradeWalletBanner({ onUpgradeClick }: UpgradeWalletBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-600 text-xs">
      <ShieldAlert className="w-4 h-4 shrink-0" />
      <span className="flex-1">Wallet kamu masih pakai alamat sementara. Upgrade ke self-custody untuk keamanan penuh.</span>
      <Button size="sm" variant="outline" className="h-6 px-2 text-[10px] shrink-0" onClick={onUpgradeClick}>Upgrade</Button>
      <button onClick={() => setDismissed(true)} className="shrink-0"><X className="w-3.5 h-3.5" /></button>
    </div>
  );
}
