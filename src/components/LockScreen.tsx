
"use client"

import { useState } from 'react';
import { Shield, Fingerprint, Lock, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/hooks/use-toast';

interface LockScreenProps {
  onUnlock: (password: string) => boolean;
}

export function LockScreen({ onUnlock }: LockScreenProps) {
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleUnlock = () => {
    if (!password) return;
    setIsLoading(true);
    
    // Simulate check delay for security feeling
    setTimeout(() => {
      const success = onUnlock(password);
      if (!success) {
        toast({
          variant: "destructive",
          title: "Access Denied",
          description: "Incorrect vault password.",
        });
        setIsLoading(false);
      }
    }, 500);
  };

  return (
    <div className="fixed inset-0 z-[200] bg-background/95 backdrop-blur-3xl flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-700">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-primary/5 rounded-full blur-[120px]" />
      </div>

      <div className="relative mb-12">
        <div className="w-24 h-24 rounded-[2rem] bg-gradient-to-br from-primary/20 to-accent/10 flex items-center justify-center border border-primary/30 shadow-[0_0_80px_-15px_rgba(139,92,246,0.5)] relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/5 to-transparent -translate-x-full animate-shimmer" />
          <Shield className="w-10 h-10 text-primary" />
        </div>
        <div className="absolute -bottom-1 -right-1 w-8 h-8 bg-accent rounded-full flex items-center justify-center border-4 border-background shadow-lg">
          <Lock className="w-3.5 h-3.5 text-white" />
        </div>
      </div>
      
      <div className="space-y-2 mb-8">
        <h2 className="text-3xl font-headline font-bold tracking-tight text-foreground">Vault Locked</h2>
        <p className="text-[10px] text-primary font-bold uppercase tracking-[0.4em] animate-pulse">Enter Password to Unlock</p>
      </div>

      <div className="w-full max-w-[300px] space-y-4">
        <Input 
          type="password"
          placeholder="Vault Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
          className="h-14 bg-secondary/30 border-primary/10 rounded-2xl text-center text-lg focus-visible:ring-primary/50"
          autoFocus
        />
        <Button 
          onClick={handleUnlock}
          disabled={isLoading || !password}
          className="h-14 w-full rounded-2xl bg-primary text-primary-foreground font-bold text-lg shadow-[0_10px_40px_-10px_rgba(139,92,246,0.6)] hover:scale-[1.02] transition-all active:scale-95 flex items-center justify-center gap-3"
        >
          {isLoading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Fingerprint className="w-6 h-6" />}
          {isLoading ? "Unlocking..." : "Unlock Vault"}
        </Button>
      </div>
      
      <div className="mt-12 space-y-4 max-w-[240px]">
        <p className="text-[9px] text-muted-foreground font-bold uppercase tracking-widest leading-relaxed opacity-60">
          Your keys are encrypted locally. EAST never stores your password.
        </p>
      </div>
    </div>
  );
}
