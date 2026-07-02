"use client"

import React, { useState } from 'react';
import { useWallet } from '@/lib/wallet-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Lock, Loader2, ShieldCheck } from 'lucide-react';
import { Logo } from '@/components/brand/Logo';

export function WalletGuardian({ children }: { children: React.ReactNode }) {
  const { isLocked, unlock, isLoading } = useWallet();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [unlocking, setUnlocking] = useState(false);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        <p className="text-[10px] text-muted-foreground uppercase tracking-widest font-bold">Loading Vault...</p>
      </div>
    );
  }

  if (!isLocked) return <>{children}</>;

  const handleUnlock = async () => {
    if (!password) return;
    setUnlocking(true);
    setError('');
    const success = await unlock(password);
    if (!success) {
      setError('Incorrect password. Try again.');
    }
    setPassword('');
    setUnlocking(false);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-8 p-6 text-center">
      <div className="space-y-3">
        <div className="w-20 h-20 rounded-[2rem] bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto shadow-[0_0_40px_-5px_rgba(139,92,246,0.3)]">
          <Lock className="w-9 h-9 text-primary" />
        </div>
        <h1 className="text-3xl font-headline font-bold">Vault Locked</h1>
        <p className="text-sm text-muted-foreground max-w-[260px] mx-auto leading-relaxed">
          Enter your password to unlock and access your wallet.
        </p>
      </div>

      <div className="w-full max-w-[300px] space-y-4">
        <Input
          type="password"
          placeholder="Vault Password"
          value={password}
          onChange={(e) => { setPassword(e.target.value); setError(''); }}
          onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
          className="h-14 bg-secondary/30 rounded-2xl border-white/5 px-6 text-center text-sm"
          autoFocus
        />
        {error && (
          <p className="text-[11px] text-red-400 font-medium">{error}</p>
        )}
        <Button
          onClick={handleUnlock}
          disabled={!password || unlocking}
          className="w-full h-14 rounded-[2rem] bg-primary font-bold text-lg shadow-xl shadow-primary/20"
        >
          {unlocking ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Unlock Vault'}
        </Button>
      </div>

      <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-bold uppercase tracking-[0.4em] opacity-40">
        <ShieldCheck className="w-4 h-4" />
        AES-256 Encrypted
      </div>
    </div>
  );
}
