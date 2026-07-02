"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { 
  ShieldCheck, 
  Info, 
  ArrowDownCircle,
  ArrowUpCircle
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface OrderFormProps {
  tradingPair: string;
}

export function OrderForm({ tradingPair }: OrderFormProps) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [orderType, setOrderType] = useState("limit");
  const [amount, setAmount] = useState([0]);
  const [price, setPrice] = useState("1.2450");
  const [base, quote] = tradingPair.split("/");

  const handleExecute = () => {
    const numericPrice = parseFloat(price);
    if (isNaN(numericPrice)) return;

    const event = new CustomEvent('east-p2p-new-trade', {
      detail: {
        price: numericPrice,
        side: side,
        amount: amount[0],
      }
    });
    window.dispatchEvent(event);
  };

  return (
    <div className="p-6 flex flex-col gap-6 bg-card/20 border-b border-border">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Execution Panel</h3>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>
              <Info className="w-3.5 h-3.5 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-[10px]">Professional Trading & P2P Escrow</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <Tabs value={side} onValueChange={(v: any) => setSide(v)} className="w-full">
        <TabsList className="grid grid-cols-2 bg-secondary/30 p-1 h-12">
          <TabsTrigger 
            value="buy" 
            className="data-[state=active]:bg-chart-2 data-[state=active]:text-white font-bold h-full gap-2 transition-all"
          >
            <ArrowDownCircle className="w-4 h-4" />
            BUY
          </TabsTrigger>
          <TabsTrigger 
            value="sell" 
            className="data-[state=active]:bg-chart-3 data-[state=active]:text-white font-bold h-full gap-2 transition-all"
          >
            <ArrowUpCircle className="w-4 h-4" />
            SELL
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Mode</Label>
            <select 
              value={orderType}
              onChange={(e) => setOrderType(e.target.value)}
              className="w-full bg-secondary/50 border border-border rounded-md px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary text-foreground font-semibold"
            >
              <option value="limit">Limit Order</option>
              <option value="market">Market Order</option>
              <option value="p2p">P2P Escrow</option>
              <option value="stop">Stop Limit</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Leverage</Label>
            <div className="bg-primary/5 border border-primary/20 rounded-md px-2 py-1.5 text-xs text-primary font-bold text-center">
              Isolated 10x
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between items-end">
            <Label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
              {orderType === 'p2p' ? 'Target Price' : `Price (${quote})`}
            </Label>
            {orderType === 'market' && (
              <span className="text-[10px] text-primary font-bold">Market Price</span>
            )}
          </div>
          <div className="relative group">
            <Input 
              className="bg-secondary/40 border-border font-data h-10 group-hover:border-primary/50 transition-colors" 
              placeholder="0.0000" 
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              disabled={orderType === 'market'}
              type="number"
              step="0.0001"
            />
            <span className="absolute right-3 top-2.5 text-[10px] text-muted-foreground font-bold">{quote}</span>
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Amount ({base})</Label>
          <div className="relative group">
            <Input className="bg-secondary/40 border-border font-data h-10 group-hover:border-primary/50 transition-colors" placeholder="0.00" />
            <span className="absolute right-3 top-2.5 text-[10px] text-muted-foreground font-bold">{base}</span>
          </div>
        </div>

        <div className="py-2 space-y-3">
          <Slider 
            value={amount} 
            onValueChange={setAmount} 
            max={100} 
            step={25} 
            className="[&_[role=slider]]:bg-primary" 
          />
          <div className="flex justify-between text-[10px] font-bold text-muted-foreground px-1">
            <span className="cursor-pointer hover:text-primary" onClick={() => setAmount([0])}>0%</span>
            <span className="cursor-pointer hover:text-primary" onClick={() => setAmount([25])}>25%</span>
            <span className="cursor-pointer hover:text-primary" onClick={() => setAmount([50])}>50%</span>
            <span className="cursor-pointer hover:text-primary" onClick={() => setAmount([75])}>75%</span>
            <span className="cursor-pointer hover:text-primary" onClick={() => setAmount([100])}>100%</span>
          </div>
        </div>

        <div className="space-y-2.5 border-t border-border pt-4">
          <div className="flex justify-between text-[11px]">
            <span className="text-muted-foreground font-medium">Fee (0.1%)</span>
            <span className="font-data text-foreground">0.0000 {quote}</span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-muted-foreground font-medium">Est. Total</span>
            <span className="font-data text-foreground font-bold">0.0000 {quote}</span>
          </div>
          <div className="flex justify-between text-[11px] bg-primary/5 p-2 rounded border border-primary/10">
            <span className="text-muted-foreground font-medium">Available Wallet</span>
            <div className="flex items-center gap-1.5">
              <span className="font-data text-primary font-bold">12,500.00</span>
              <span className="text-[9px] text-muted-foreground font-bold uppercase">{quote}</span>
            </div>
          </div>
        </div>

        <div className="space-y-3 pt-2">
          <Button 
            onClick={handleExecute}
            className={`w-full h-14 font-bold tracking-widest text-white transition-all transform active:scale-[0.97] shadow-lg rounded-xl flex flex-col items-center justify-center gap-0.5 ${
              side === "buy" 
                ? "bg-chart-2 hover:bg-chart-2/90 glow-primary border-none" 
                : "bg-chart-3 hover:bg-chart-3/90 border-none"
            }`}
          >
            <span className="text-sm font-black uppercase italic">
              {side === "buy" ? `PRO BUY ${base}` : `PRO SELL ${base}`}
            </span>
            <span className="text-[9px] opacity-70 font-medium tracking-normal">
              {orderType === 'p2p' ? 'SECURE P2P ESCROW ACTIVE' : 'EXECUTE INSTANT ORDER'}
            </span>
          </Button>
          
          <div className="flex items-center justify-center gap-2 text-[10px] text-muted-foreground font-semibold">
            <ShieldCheck className="w-3.5 h-3.5 text-chart-2" />
            <span>Secured by EAST Smart Escrow</span>
          </div>
        </div>
      </div>
    </div>
  );
}
