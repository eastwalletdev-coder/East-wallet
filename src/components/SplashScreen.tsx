"use client"

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';

/**
 * Full-screen boot splash only — rendered from layout.tsx, independent of
 * the home page globe/logo. Scaling here does NOT affect / (home).
 */
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

  // Shared letter metrics — base + shine must match or E/Λ shimmer glitches
  const letterE = "font-logo text-[1em] -translate-x-[0.03em] mr-[0.05em] leading-none";
  const letterA = "font-logo text-[1.15em] mx-[0.12em] font-normal leading-none translate-y-[-0.05em]";
  const letterST = "font-logo text-[1em] leading-none";

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
          "absolute w-[min(90vw,520px)] h-[min(90vw,520px)] bg-primary/10 rounded-full blur-[100px] transition-all duration-1000 delay-300",
          isGateOpen ? "opacity-100 scale-150" : "opacity-0 scale-50"
        )} />
      </div>

      <div className={cn(
        "relative flex flex-col items-center gap-12 z-30 transition-all duration-700 ease-out delay-500 w-full max-w-[min(92vw,440px)] px-4",
        isGateOpen ? "opacity-100 translate-y-0 scale-100" : "opacity-0 translate-y-8 scale-90"
      )}>
        <div className="flex flex-col items-center text-center w-full">
          <h1 className="text-[clamp(3rem,14vw,4.5rem)] font-bold tracking-tight uppercase flex items-center justify-center filter drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] relative">
            <div className="flex items-center relative z-10">
              <span className={cn(letterE, "text-primary")}>E</span>
              <span className={cn(letterA, "text-white")}>Λ</span>
              <span className={cn(letterST, "text-primary")}>ST</span>
            </div>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
              <div
                className="flex items-center animate-shimmer-shine text-transparent bg-clip-text select-none"
                style={{
                  backgroundImage:
                    'linear-gradient(90deg, transparent 0%, transparent 40%, rgba(255,255,255,0.85) 50%, transparent 60%, transparent 100%)',
                  backgroundSize: '200% 100%',
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                }}
              >
                <span className={letterE}>E</span>
                <span className={letterA}>Λ</span>
                <span className={letterST}>ST</span>
              </div>
            </div>
          </h1>
          <div className="mt-5 flex flex-col items-center gap-2 w-full px-2">
            <p className="text-[clamp(11px,3.2vw,14px)] uppercase font-black tracking-[0.08em] text-white leading-tight text-center">
              One Smartphone One Node One Future
            </p>
            <p className="text-[clamp(9px,2.4vw,11px)] uppercase font-extrabold tracking-[0.1em] text-primary leading-relaxed text-center">
              Layer 1 Secure With P2P Mobile Browser Lightnode
            </p>
          </div>
        </div>

        {/* Globe — larger than before (was w-40) */}
        <div className="relative group flex items-center justify-center">
          <div className="absolute inset-0 rounded-full shadow-[0_0_120px_-5px_rgba(139,92,246,0.75)] animate-pulse" />
          <div
            className="rounded-full border border-primary/50 flex items-center justify-center bg-gradient-to-br from-white/10 to-black/90 backdrop-blur-xl relative overflow-hidden"
            style={{ width: 'min(56vw, 240px)', height: 'min(56vw, 240px)' }}
          >
            <div className="absolute inset-0 z-40 animate-rotate-beam pointer-events-none">
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[2px] bg-gradient-to-r from-transparent via-white to-transparent blur-[2px]" />
            </div>
            <div className="absolute inset-0 flex items-center justify-center animate-globe-spin" style={{ transformStyle: 'preserve-3d' }}>
              {[...Array(16)].map((_, i) => (
                <div
                  key={i}
                  className="absolute inset-0 border-x border-primary/50 rounded-full"
                  style={{
                    transform: `rotateY(${i * 11.25}deg)`,
                    borderWidth: '1px',
                    backfaceVisibility: 'hidden',
                    WebkitBackfaceVisibility: 'hidden',
                  }}
                />
              ))}
            </div>
            <div className="absolute inset-0 flex flex-col justify-around py-2 opacity-80 z-10 pointer-events-none">
              {[...Array(12)].map((_, i) => (
                <div
                  key={`h-${i}`}
                  className="w-full h-[1px] bg-primary/40"
                  style={mounted ? { opacity: 0.3 + Math.sin(((i + 0.5) / 12) * Math.PI) * 0.7 } : {}}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className={cn(
        "absolute bottom-10 flex flex-col items-center gap-3 transition-all duration-1000 delay-1000",
        isGateOpen ? "opacity-50" : "opacity-0"
      )}>
        <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-[0.4em]">
          Design By East Protocol
        </p>
        <div className="w-40 h-[1px] bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
      </div>
    </div>
  );
}
