"use client"

import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Search, Globe, ArrowRight, X, RotateCw, ShieldCheck, ExternalLink, Home as HomeIcon, AlertCircle, Repeat, Zap } from "lucide-react";
import Image from "next/image";
import { PlaceHolderImages } from "@/lib/placeholder-images";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import Link from "next/link";

const featuredDApps = [
  { name: 'Uniswap', category: 'DEX', url: 'https://app.uniswap.org', iconId: 'uniswap-logo' },
  { name: 'OpenSea', category: 'NFTs', url: 'https://opensea.io', iconId: 'opensea-logo' },
  { name: 'Aave', category: 'Lending', url: 'https://app.aave.com', iconId: 'aave-logo' },
];

const categories = ['All', 'DeFi', 'NFTs', 'Social', 'Tools', 'Gaming'];

export default function BrowserPage() {
  const [activeUrl, setActiveUrl] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showIframeWarning, setShowIframeWarning] = useState(false);

  const getPlaceholderImageData = (id: string) => {
    const img = PlaceHolderImages.find(img => img.id === id);
    return {
      url: img?.imageUrl || `https://picsum.photos/seed/${id}/128/128`,
      hint: img?.imageHint || 'web3 app'
    };
  };

  const handleNavigate = (url: string) => {
    const trimmed = url.trim();
    if (!trimmed) return;

    let finalUrl = trimmed;
    
    const isUrl = trimmed.includes('.') && !trimmed.includes(' ');
    
    if (!isUrl && !trimmed.startsWith('http')) {
      finalUrl = `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
    } else if (!trimmed.startsWith('http')) {
      finalUrl = `https://${trimmed}`;
    }

    setActiveUrl(finalUrl);
    setInputValue(finalUrl);
    setIsLoading(true);
    setShowIframeWarning(false);
  };

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isLoading && activeUrl) {
      timer = setTimeout(() => {
        if (isLoading) setShowIframeWarning(true);
      }, 5000);
    }
    return () => clearTimeout(timer);
  }, [isLoading, activeUrl]);

  const closeBrowser = () => {
    setActiveUrl(null);
    setInputValue("");
    setShowIframeWarning(false);
  };

  const openExternal = () => {
    if (activeUrl) {
      window.open(activeUrl, '_blank');
    }
  };

  if (activeUrl) {
    return (
      <div className="flex flex-col h-screen bg-background">
        <div className="p-3 border-b border-primary/20 flex items-center gap-2 bg-primary/5 sticky top-0 z-50 backdrop-blur-md">
          <Button variant="ghost" size="icon" onClick={closeBrowser} className="rounded-xl h-9 w-9 shrink-0 hover:bg-primary/10">
            <HomeIcon className="w-4 h-4 text-primary" />
          </Button>
          
          <div className="flex-1 relative group">
            <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pointer-events-none">
              <ShieldCheck className="w-3 h-3 text-primary" />
              <div className="w-[1px] h-3 bg-primary/20" />
            </div>
            <Input 
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleNavigate(inputValue)}
              className="h-9 pl-10 pr-10 text-[10px] bg-secondary/50 border-none rounded-lg focus-visible:ring-primary/30 font-medium"
            />
            <Button 
              variant="ghost" 
              size="icon" 
              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 text-muted-foreground hover:text-primary"
              onClick={() => setInputValue("")}
            >
              <X className="w-3 h-3" />
            </Button>
          </div>

          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 hover:bg-primary/10" onClick={() => handleNavigate(activeUrl)}>
              <RotateCw className={cn("w-4 h-4 text-primary", isLoading && "animate-spin")} />
            </Button>
            <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 hover:bg-primary/10" onClick={openExternal}>
              <ExternalLink className="w-4 h-4 text-primary" />
            </Button>
          </div>
        </div>

        <div className="flex-1 bg-white relative overflow-hidden">
          {isLoading && (
            <div className="absolute inset-0 bg-background flex flex-col items-center justify-center z-20">
              <div className="w-16 h-16 rounded-3xl bg-primary/5 flex items-center justify-center mb-6 relative">
                <div className="absolute inset-0 rounded-3xl border border-primary/20 animate-ping opacity-20" />
                <Globe className="w-8 h-8 text-primary animate-pulse" />
              </div>
              <div className="space-y-2 text-center">
                <p className="text-[10px] font-bold text-primary tracking-[0.3em] uppercase animate-pulse">Establishing Secure Node</p>
                <p className="text-[8px] text-muted-foreground font-mono">Connecting via {activeUrl.split('/')[2] || 'RPC'}</p>
              </div>
            </div>
          )}
          
          <iframe 
            src={activeUrl} 
            className="w-full h-full border-none"
            onLoad={() => setIsLoading(false)}
            title="dApp Browser"
            sandbox="allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-scripts allow-same-origin allow-storage-access-by-user-activation"
          />

          {showIframeWarning && (
            <div className="absolute bottom-6 left-4 right-4 p-4 bg-card/95 border border-primary/20 rounded-2xl flex flex-col gap-3 shadow-[0_10px_40px_-10px_rgba(255,102,0,0.3)] animate-in slide-in-from-bottom-4 duration-500 z-10">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-primary/10 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-primary" />
                </div>
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-foreground">Content Restricted?</span>
                  <span className="text-[10px] text-muted-foreground leading-tight">Many sites (Facebook, Uniswap) block in-app views for security. If you see an error, please open in your system browser.</span>
                </div>
              </div>
              <Button size="sm" className="w-full bg-primary text-primary-foreground font-bold rounded-xl h-10 shadow-lg shadow-primary/20" onClick={openExternal}>
                <ExternalLink className="w-4 h-4 mr-2" />
                Open External Browser
              </Button>
            </div>
          )}
        </div>

        <div className="p-2 bg-primary/5 border-t border-primary/10 flex items-center justify-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-[10px] font-bold text-primary tracking-tight uppercase">East Injection API Active</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8 p-6 pb-40">
      <header>
        <h1 className="font-headline font-bold text-3xl mb-2">Explore</h1>
        <p className="text-muted-foreground text-sm">Discover Web3 and manage your DeFi assets.</p>
      </header>

      <section className="grid grid-cols-2 gap-3">
        <Link href="/swap" className="flex-1">
          <Button variant="outline" className="w-full h-20 rounded-3xl border-primary/10 bg-primary/5 hover:bg-primary/10 hover:border-primary/20 transition-all group flex flex-col gap-1.5 items-center justify-center">
            <div className="p-2 bg-primary/10 rounded-xl group-hover:scale-110 transition-transform">
              <Repeat className="w-5 h-5 text-primary" />
            </div>
            <span className="text-[10px] font-bold uppercase tracking-widest">Swap Assets</span>
          </Button>
        </Link>
        <Link href="/stake" className="flex-1">
          <Button variant="outline" className="w-full h-20 rounded-3xl border-accent/10 bg-accent/5 hover:bg-accent/10 hover:border-accent/20 transition-all group flex flex-col gap-1.5 items-center justify-center">
            <div className="p-2 bg-accent/10 rounded-xl group-hover:scale-110 transition-transform">
              <Zap className="w-5 h-5 text-accent" />
            </div>
            <span className="text-[10px] font-bold uppercase tracking-widest">Stake & Earn</span>
          </Button>
        </Link>
      </section>

      <div className="relative group">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
        <Input 
          placeholder="Enter dApp URL or search" 
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleNavigate(inputValue)}
          className="pl-10 h-12 bg-secondary/30 border-primary/10 rounded-xl focus:ring-primary/50 text-sm" 
        />
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
        {categories.map((cat, idx) => (
          <button key={cat} className={`px-4 py-2 rounded-full text-[10px] font-bold whitespace-nowrap transition-all border ${idx === 0 ? 'bg-primary text-primary-foreground border-primary shadow-lg shadow-primary/20' : 'bg-white/5 border-border/50 text-muted-foreground hover:border-primary/30'}`}>
            {cat}
          </button>
        ))}
      </div>

      <section>
        <div className="flex items-center gap-2 mb-4">
          <div className="p-1.5 bg-primary/10 rounded-lg">
            <Globe className="w-4 h-4 text-primary" />
          </div>
          <h2 className="font-headline font-bold text-xl">Featured dApps</h2>
        </div>
        <div className="grid grid-cols-1 gap-4">
          {featuredDApps.map((dapp) => {
            const imgData = getPlaceholderImageData(dapp.iconId);
            return (
              <div 
                key={dapp.name} 
                onClick={() => handleNavigate(dapp.url)}
                className="glass p-4 rounded-2xl flex items-center justify-between group cursor-pointer hover:bg-primary/5 transition-all border-primary/5"
              >
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl overflow-hidden bg-secondary/50 flex items-center justify-center p-2 group-hover:scale-110 transition-transform shadow-sm">
                    <Image 
                      src={imgData.url} 
                      alt={dapp.name} 
                      width={64} 
                      height={64} 
                      className="rounded-xl"
                      data-ai-hint={imgData.hint}
                    />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold">{dapp.name}</h3>
                      <span className="text-[10px] font-bold bg-primary/10 text-primary px-2 py-0.5 rounded-full uppercase">{dapp.category}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Visit {dapp.name.toLowerCase()}</p>
                  </div>
                </div>
                <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-all group-hover:translate-x-1" />
              </div>
            );
          })}
        </div>
      </section>

      <div className="p-5 bg-primary/5 border border-primary/10 rounded-3xl space-y-3">
        <div className="flex items-center gap-2 text-primary">
          <ShieldCheck className="w-4 h-4" />
          <span className="text-[10px] font-bold uppercase tracking-wider">Secure Web3 Gateway</span>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Eastchain browser simulates transactions before you sign them, protecting your assets from malicious scripts and phishing attempts.
        </p>
      </div>
    </div>
  );
}
