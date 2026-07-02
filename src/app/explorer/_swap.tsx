"use client"

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Repeat, ChevronDown, Settings2, Info, ArrowDown, Loader2, Sparkles, CheckCircle2 } from "lucide-react";
import Image from "next/image";
import { PlaceHolderImages } from "@/lib/placeholder-images";
import { useWallet } from "@/lib/wallet-context";
import { useRPC } from "@/lib/rpc-context";
import { getTokenLibrary, Token } from "@/lib/token-service";
import { getSwapQuote, executeSwapSimulation, SwapQuote } from "@/lib/dex-service";
import { toast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export default function SwapContent() {
  const { accounts, mnemonic } = useWallet();
  const { selectedChain } = useRPC();
  
  const [fromToken, setFromToken] = useState<Token | null>(null);
  const [toToken, setToToken] = useState<Token | null>(null);
  const [fromAmount, setFromAmount] = useState('');
  const [tokenList, setTokenList] = useState<Token[]>([]);
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [isQuoting, setIsQuoting] = useState(false);
  const [isSwapping, setIsSwapping] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // Initialize tokens based on library
  useEffect(() => {
    getTokenLibrary(selectedChain).then(list => {
      setTokenList(list);
      setFromToken(list[0]);
      setToToken(list[1]);
    });
  }, [selectedChain]);

  // Fetch quote when inputs change
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (fromToken && toToken && fromAmount && parseFloat(fromAmount) > 0) {
        setIsQuoting(true);
        const newQuote = await getSwapQuote(fromToken, toToken, fromAmount);
        setQuote(newQuote);
        setIsQuoting(false);
      } else {
        setQuote(null);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [fromToken, toToken, fromAmount]);

  const handleSwap = async () => {
    if (!quote) return;
    setIsSwapping(true);
    const result = await executeSwapSimulation(quote);
    setIsSwapping(false);
    setShowConfirm(false);
    
    if (result.success) {
      toast({
        title: "Swap Successful",
        description: `Exchanged ${quote.fromAmount} ${quote.fromToken.symbol} for ${quote.toAmount} ${quote.toToken.symbol}`,
      });
      setFromAmount('');
    }
  };

  const switchTokens = () => {
    const temp = fromToken;
    setFromToken(toToken);
    setToToken(temp);
  };

  const activeAccount = accounts.find(a => a.chain === selectedChain);

  return (
    <div className="flex flex-col gap-8 p-6 pb-40">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-headline font-bold text-3xl mb-1">Swap</h1>
          <div className="flex items-center gap-2">
            <Sparkles className="w-3 h-3 text-primary animate-pulse" />
            <p className="text-muted-foreground text-[10px] uppercase tracking-widest font-bold">Aggregator Core Active</p>
          </div>
        </div>
        <Button variant="ghost" size="icon" className="rounded-full bg-secondary/30">
          <Settings2 className="w-5 h-5" />
        </Button>
      </header>

      <div className="relative flex flex-col gap-2">
        {/* From Section */}
        <div className="glass p-5 rounded-3xl bg-white/[0.02] border-white/5 relative overflow-hidden">
          {isQuoting && <div className="absolute top-0 left-0 w-full h-[2px] bg-primary animate-shimmer" />}
          <div className="flex justify-between items-center mb-4">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em]">You Sell</span>
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
              Balance: {activeAccount?.balance || '0.00'}
            </span>
          </div>
          <div className="flex justify-between items-center gap-4">
            <Input 
              type="number" 
              placeholder="0.0"
              value={fromAmount}
              onChange={(e) => setFromAmount(e.target.value)}
              className="text-3xl font-headline font-bold bg-transparent border-none p-0 focus-visible:ring-0 w-1/2 placeholder:text-muted-foreground/30" 
            />
            
            <TokenSelector 
              selected={fromToken} 
              tokens={tokenList} 
              onSelect={setFromToken} 
            />
          </div>
        </div>

        {/* Swap Button Middle */}
        <div className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 z-10">
          <Button 
            size="icon" 
            onClick={switchTokens}
            className="rounded-2xl w-12 h-12 bg-background border-4 border-background text-primary shadow-xl hover:scale-110 transition-transform active:rotate-180 duration-500"
          >
            <ArrowDown className="w-6 h-6" />
          </Button>
        </div>

        {/* To Section */}
        <div className="glass p-5 rounded-3xl bg-white/[0.02] border-white/5 pt-8">
          <div className="flex justify-between items-center mb-4">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em]">You Buy</span>
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Estimated</span>
          </div>
          <div className="flex justify-between items-center gap-4">
            <div className="text-3xl font-headline font-bold text-foreground overflow-hidden truncate">
              {isQuoting ? (
                <div className="h-9 w-24 bg-secondary/30 rounded-lg animate-pulse" />
              ) : (
                quote?.toAmount || "0.0"
              )}
            </div>
            
            <TokenSelector 
              selected={toToken} 
              tokens={tokenList} 
              onSelect={setToToken} 
            />
          </div>
        </div>
      </div>

      {quote && (
        <div className="glass p-5 rounded-2xl space-y-3 bg-white/[0.01] border-white/5 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="flex justify-between items-center text-[10px] uppercase font-bold tracking-widest">
            <div className="flex items-center gap-1 text-muted-foreground">
              <span>Best Rate</span>
              <Info className="w-3 h-3" />
            </div>
            <span className="text-foreground">1 {fromToken?.symbol} = {quote.exchangeRate} {toToken?.symbol}</span>
          </div>
          <div className="flex justify-between items-center text-[10px] uppercase font-bold tracking-widest">
            <div className="flex items-center gap-1 text-muted-foreground">
              <span>Price Impact</span>
              <Info className="w-3 h-3" />
            </div>
            <span className={cn(
              parseFloat(quote.priceImpact) > 2 ? "text-red-400" : "text-green-400"
            )}>{quote.priceImpact}</span>
          </div>
          <div className="flex justify-between items-center text-[10px] uppercase font-bold tracking-widest">
            <div className="flex items-center gap-1 text-muted-foreground">
              <span>Aggregator Fee</span>
              <Info className="w-3 h-3" />
            </div>
            <span className="text-foreground">{quote.fee}</span>
          </div>
          
          <div className="pt-3 border-t border-white/5 flex items-center gap-2">
            <div className="p-1 bg-primary/10 rounded-md">
              <Repeat className="w-3 h-3 text-primary" />
            </div>
            <p className="text-[9px] text-muted-foreground uppercase font-medium">Route: {quote.route.join(' → ')}</p>
          </div>
        </div>
      )}

      <Button 
        onClick={() => setShowConfirm(true)}
        disabled={!quote || !mnemonic || isQuoting}
        className="h-16 w-full bg-primary text-primary-foreground font-bold text-xl rounded-3xl shadow-[0_10px_40px_-5px_rgba(139,92,246,0.5)] hover:scale-[1.02] active:scale-[0.98] transition-all"
      >
        {isQuoting ? <Loader2 className="w-6 h-6 animate-spin" /> : "Review Swap"}
      </Button>

      {/* Confirmation Dialog */}
      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent className="sm:max-w-[400px] bg-background border-primary/20 rounded-[2.5rem] p-0 overflow-hidden outline-none">
          <DialogHeader className="sr-only">
            <DialogTitle>Confirm Swap</DialogTitle>
          </DialogHeader>
          
          <div className="p-8 bg-primary/10 border-b border-white/5 flex flex-col items-center text-center gap-6">
            <div className="flex items-center gap-4">
              <div className="flex flex-col items-center gap-2">
                <div className="w-12 h-12 rounded-2xl bg-secondary flex items-center justify-center p-2 shadow-lg">
                  <img src={fromToken?.logoURI} alt={fromToken?.symbol} className="w-full h-full object-contain" />
                </div>
                <span className="text-[10px] font-bold">{fromToken?.symbol}</span>
              </div>
              <ArrowDown className="-rotate-90 text-primary w-6 h-6" />
              <div className="flex flex-col items-center gap-2">
                <div className="w-12 h-12 rounded-2xl bg-secondary flex items-center justify-center p-2 shadow-lg">
                  <img src={toToken?.logoURI} alt={toToken?.symbol} className="w-full h-full object-contain" />
                </div>
                <span className="text-[10px] font-bold">{toToken?.symbol}</span>
              </div>
            </div>
            <div className="space-y-1">
              <h3 className="text-3xl font-headline font-bold">{quote?.toAmount} {toToken?.symbol}</h3>
              <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest">Estimated Output</p>
            </div>
          </div>

          <div className="px-2 py-4 space-y-6">
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-bold text-muted-foreground uppercase">Network Fee</span>
                <span className="text-[10px] font-bold">~ $0.12</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[10px] font-bold text-muted-foreground uppercase">Rate Impact</span>
                <span className="text-[10px] font-bold text-green-400">{quote?.priceImpact}</span>
              </div>
            </div>

            <Button 
              className="w-full h-14 bg-primary text-white font-bold rounded-2xl text-lg shadow-lg shadow-primary/20"
              onClick={handleSwap}
              disabled={isSwapping}
            >
              {isSwapping ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <CheckCircle2 className="w-5 h-5 mr-2" />}
              {isSwapping ? "Executing Swap..." : "Confirm Swap"}
            </Button>
            
            <p className="text-[9px] text-center text-muted-foreground uppercase font-bold tracking-widest">
              Secured by EAST Multi-Chain Aggregator
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TokenSelector({ selected, tokens, onSelect }: { selected: Token | null, tokens: Token[], onSelect: (t: Token) => void }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="secondary" className="bg-secondary/50 hover:bg-secondary rounded-2xl flex items-center gap-2 h-12 px-3 border border-white/5 shrink-0 min-w-[100px]">
          {selected && (
            <div className="w-6 h-6 rounded-lg overflow-hidden bg-white/10 p-0.5">
              <img src={selected.logoURI} alt={selected.symbol} className="w-full h-full object-contain" />
            </div>
          )}
          <span className="font-bold text-sm">{selected?.symbol || 'Select'}</span>
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[400px] bg-background border-primary/20 rounded-[2.5rem] p-6 max-h-[80vh] overflow-y-auto outline-none">
        <DialogHeader>
          <DialogTitle className="font-headline text-2xl">Select Token</DialogTitle>
        </DialogHeader>
        <div className="grid gap-2 mt-4">
          {tokens.map((token) => (
            <div 
              key={token.symbol}
              onClick={() => onSelect(token)}
              className={cn(
                "flex items-center justify-between p-4 rounded-2xl cursor-pointer transition-all border",
                selected?.symbol === token.symbol ? "bg-primary/10 border-primary/30" : "bg-secondary/20 border-transparent hover:bg-secondary/40"
              )}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-background flex items-center justify-center p-1.5 shadow-sm">
                  <img src={token.logoURI} alt={token.name} className="w-full h-full object-contain" />
                </div>
                <div>
                  <h4 className="font-bold text-sm">{token.name}</h4>
                  <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest">{token.symbol}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-bold text-primary">{token.change}</p>
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
