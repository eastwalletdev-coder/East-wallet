
"use client"

import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
}

export function Logo({ className, size = "md" }: LogoProps) {
  const sizeClasses = {
    sm: "text-lg tracking-[0.1em]",
    md: "text-2xl tracking-[0.15em]",
    lg: "text-4xl tracking-[0.2em]",
    xl: "text-5xl tracking-[0.25em]",
  };

  const iconSizes = {
    sm: "w-5 h-5",
    md: "w-7 h-7",
    lg: "w-10 h-10",
    xl: "w-12 h-12",
  };

  return (
    <div className={cn("flex flex-col items-center justify-center space-y-2", className)}>
      <div className={cn("relative flex items-center justify-center", iconSizes[size])}>
        <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-[0_0_8px_rgba(124,58,237,0.5)]">
          <defs>
            <linearGradient id="logo-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fff" />
              <stop offset="50%" stopColor="#7c3aed" />
              <stop offset="100%" stopColor="#3b82f6" />
            </linearGradient>
          </defs>
          <path
            d="M50 10 L90 30 L90 70 L50 90 L10 70 L10 30 Z"
            fill="none"
            stroke="url(#logo-grad)"
            strokeWidth="4"
            className="animate-[pulse_4s_infinite]"
          />
          <path
            d="M30 40 L50 30 L70 40 L70 60 L50 70 L30 60 Z"
            fill="url(#logo-grad)"
            className="opacity-80"
          />
          <circle cx="50" cy="50" r="5" fill="#fff" className="animate-pulse" />
        </svg>
        
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-1/2 w-1 h-1 bg-white rounded-full animate-ping delay-75"></div>
          <div className="absolute bottom-1/4 right-0 w-0.5 h-0.5 bg-primary rounded-full animate-pulse delay-300"></div>
          <div className="absolute top-1/4 left-0 w-1 h-1 bg-secondary rounded-full animate-bounce delay-500"></div>
        </div>
      </div>
      
      <h1 className={cn(
        "font-headline font-bold uppercase italic glitter-text drop-shadow-2xl",
        sizeClasses[size]
      )}>
        EASTCHAIN
      </h1>
    </div>
  );
}
