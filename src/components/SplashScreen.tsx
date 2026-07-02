"use client"

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';

export function SplashScreen() {
  const [isVisible, setIsVisible] = useState(true);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [isGateOpen, setIsGateOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const gateTimer = setTimeout(() => setIsGateOpen(true), 200);
    const timer = setTimeout(() => {
      setIsFadingOut(true);
      setTimeout(() => setIsVisible(false), 800);
    }, 4500);
    return () => {
      clearTimeout(gateTimer);
      clearTimeout(timer);
    };
  }, []);

  if (!isVisible) return null;

  return (
    <div className={cn(
      "fixed inset-0 z-[100] flex items-center justify-center bg-[#050508] transition-all duration-700 ease-in-out",
      isFadingOut ? "opacity-0 scale-105 pointer-events-none" : "opacity-100 scale-100"
    )}>
      <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
        <div className={cn(
          "absolute left-0 top-0 bottom-0 w-1/2 bg-gradient-to-r from-black to-primary/5 border-r border-primary/10 transition-transform duration-[1200ms] ease-in-out z-20",
          isGateOpen ? "-translate-x-full" : "translate-x-0"
        )} />
        <div className={cn(
          "absolute right-0 top-0 bottom-0 w-1/2 bg-gradient-to-l from-black to-primary/5 border-l border-primary/10 transition-transform duration-[1200ms] ease-in-out z-20",
          isGateOpen ? "translate-x-full" : "translate-x-0"
        )} />
        <div className={cn(
          "absolute w-[400px] h-[400px] bg-primary/10 rounded-full blur-[100px] transition-all duration-1000 delay-300",
          isGateOpen ? "opacity-100 scale-150" : "opacity-0 scale-50"
        )} />
      </div>

      <div className={cn(
        "relative flex flex-col items-center gap-10 z-30 transition-all duration-700 ease-out delay-500 w-full max-w-[380px]",
        isGateOpen ? "opacity-100 translate-y-0 scale-100" : "opacity-0 translate-y-8 scale-90"
      )}>
        <div className="flex flex-col items-center text-center">
          <h1 className="text-5xl md:text-6xl font-bold tracking-tight uppercase flex items-center justify-center filter drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] relative">
            <div className="flex items-center relative z-10">
              <span className="font-logo text-primary translate-x-[-0.1em]">E</span>
              <span className="font-logo mx-0.5 text-white text-[1.15em] font-normal leading-none translate-y-[-0.05em]">Λ</span>
              <span className="font-logo text-primary">ST</span>
            </div>
            <div className="absolute inset-0 flex items-center justify-center mix-blend-screen pointer-events-none z-20">
               <div className="flex items-center animate-shimmer-shine bg-[linear-gradient(to_right,transparent_30%,white_50%,transparent_70%)] bg-[length:200%_auto] bg-clip-text text-transparent">
                 <span className="font-logo translate-x-[-0.1em]">E</span>
                 <span className="font-logo mx-0.5 text-[1.15em] font-normal leading-none translate-y-[-0.05em]">Λ</span>
                 <span className="font-logo">ST</span>
               </div>
            </div>
          </h1>
          <div className="mt-4 flex flex-col items-center gap-1.5 w-full px-4">
            <p className="text-[14px] md:text-[16px] uppercase font-black tracking-[0.1em] text-white leading-tight text-center">
              First Non-custodial Web 3.0 Wallet
            </p>
            <p className="text-[10px] md:text-[11px] uppercase font-extrabold tracking-[0.2em] text-primary leading-relaxed text-center">
              Secure With Hybrid Consensus Ledger
            </p>
          </div>
        </div>

        <div className="relative group flex items-center justify-center">
          <div className="absolute inset-0 rounded-full shadow-[0_0_100px_-5px_rgba(139,92,246,0.7)] animate-pulse" />
          <div className="w-40 h-40 rounded-full border border-primary/50 flex items-center justify-center bg-gradient-to-br from-white/10 to-black/90 backdrop-blur-xl relative overflow-hidden">
            <div className="absolute inset-0 z-40 animate-rotate-beam pointer-events-none">
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-40 h-[2px] bg-gradient-to-r from-transparent via-white/100 to-transparent blur-[2px]" />
            </div>
            <div className="absolute inset-0 flex items-center justify-center animate-globe-spin" style={{ transformStyle: 'preserve-3d' }}>
              {[...Array(16)].map((_, i) => (
                <div key={i} className="absolute inset-0 border-x border-primary/50 rounded-full" style={{ transform: `rotateY(${i * 11.25}deg)`, borderWidth: '1px' }} />
              ))}
            </div>
            <div className="absolute inset-0 flex flex-col justify-around py-2 opacity-80 z-10 pointer-events-none">
              {[...Array(12)].map((_, i) => (
                <div key={`h-${i}`} className="w-full h-[1px] bg-primary/40" style={mounted ? { opacity: 0.3 + (Math.sin(((i + 0.5) / 12) * Math.PI) * 0.7) } : {}} />
              ))}
            </div>
          </div>
        </div>
      </div>
      
      <div className={cn("absolute bottom-10 flex flex-col items-center gap-3 transition-all duration-1000 delay-1000", isGateOpen ? "opacity-50" : "opacity-0")}>
        <p className="text-[8px] font-bold text-muted-foreground uppercase tracking-[0.5em]">Design By East Protocol</p>
        <div className="w-32 h-[1px] bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
      </div>
    </div>
  );
}
