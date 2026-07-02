"use client"

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Search, Zap, Info, ChevronRight, BarChart3 } from "lucide-react";
import { Input } from "@/components/ui/input";
import Image from "next/image";
import { PlaceHolderImages } from "@/lib/placeholder-images";

const stakingOptions = [
  { name: 'Solana', symbol: 'SOL', apy: '7.4%', tvl: '$1.2B', iconId: 'sol-logo', color: 'primary' },
  { name: 'Ethereum', symbol: 'ETH', apy: '4.2%', tvl: '$12.4B', iconId: 'eth-logo', color: 'accent' },
  { name: 'Base', symbol: 'BASE', apy: '5.1%', tvl: '$420M', iconId: 'eth-logo', color: 'primary' },
];

export default function StakePage() {
  const getPlaceholderImage = (id: string) => {
    const img = PlaceHolderImages.find(img => img.id === id);
    return {
      url: img?.imageUrl || `https://picsum.photos/seed/${id}/64/64`,
      hint: img?.imageHint || 'blockchain logo'
    };
  };

  return (
    <div className="flex flex-col gap-8 p-6 pb-32">
      <header>
        <h1 className="font-headline font-bold text-3xl mb-2">Stake</h1>
        <p className="text-muted-foreground text-sm">Grow your crypto while securing the network.</p>
      </header>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input 
          placeholder="Search protocols or tokens" 
          className="pl-10 h-12 bg-secondary/30 border-white/5 rounded-xl focus:ring-primary/50" 
        />
      </div>

      <Card className="glass border-primary/20 overflow-hidden bg-gradient-to-br from-primary/10 to-transparent">
        <CardContent className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <Zap className="w-6 h-6 text-primary fill-primary" />
            <h2 className="font-headline font-bold text-xl">Total Staked</h2>
          </div>
          <div className="flex items-baseline gap-2 mb-6">
            <span className="text-4xl font-headline font-bold">$0.00</span>
            <span className="text-sm font-medium text-muted-foreground">≈ 0.00 tokens</span>
          </div>
          <div className="flex gap-4">
            <div className="flex-1 p-3 bg-white/5 rounded-xl border border-white/5">
              <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider mb-1">Rewards Earned</p>
              <p className="text-lg font-bold text-green-400">+$0.00</p>
            </div>
            <div className="flex-1 p-3 bg-white/5 rounded-xl border border-white/5">
              <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider mb-1">Average APY</p>
              <p className="text-lg font-bold">0.0%</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-headline font-bold text-xl">Top Pools</h3>
          <Info className="w-4 h-4 text-muted-foreground" />
        </div>
        <div className="space-y-4">
          {stakingOptions.map((pool) => {
            const imgData = getPlaceholderImage(pool.iconId);
            return (
              <div key={pool.name} className="glass p-5 rounded-2xl group cursor-pointer hover:bg-white/5 transition-all border-white/5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center p-1.5 overflow-hidden">
                      <Image 
                        src={imgData.url} 
                        alt={pool.name} 
                        width={40} 
                        height={40} 
                        data-ai-hint={imgData.hint}
                      />
                    </div>
                    <div>
                      <h4 className="font-bold">{pool.name}</h4>
                      <p className="text-xs text-muted-foreground uppercase">{pool.symbol}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-headline font-bold text-primary group-hover:scale-110 transition-transform origin-right">{pool.apy}</p>
                    <p className="text-[10px] text-muted-foreground font-bold tracking-widest uppercase">Est. APY</p>
                  </div>
                </div>
                <div className="flex items-center justify-between pt-4 border-t border-white/5">
                  <p className="text-xs font-medium text-muted-foreground">TVL: <span className="text-foreground">{pool.tvl}</span></p>
                  <Button size="sm" className="bg-primary/10 text-primary border border-primary/20 hover:bg-primary hover:text-primary-foreground font-bold h-8 px-4 rounded-lg">
                    Stake Now
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="p-4 bg-secondary/20 border border-white/5 rounded-2xl flex items-center justify-between cursor-pointer hover:bg-secondary/40 transition-all">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center">
            <BarChart3 className="w-5 h-5 text-muted-foreground" />
          </div>
          <div>
            <p className="font-bold text-sm">Validator Management</p>
            <p className="text-xs text-muted-foreground">Select or change your preferred validators</p>
          </div>
        </div>
        <ChevronRight className="w-5 h-5 text-muted-foreground" />
      </div>
    </div>
  );
}
