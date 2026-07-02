
"use client"

import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription 
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Send, ArrowDownLeft, Repeat, Info, ShieldCheck } from "lucide-react";
import Image from "next/image";
import { Token } from "@/lib/token-service";
import Link from "next/link";

interface TokenActionHubProps {
  token: Token | null;
  onClose: () => void;
  openSend: (token: Token) => void;
  openReceive: () => void;
}

export function TokenActionHub({ token, onClose, openSend, openReceive }: TokenActionHubProps) {
  if (!token) return null;

  return (
    <Dialog open={!!token} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[400px] bg-background border-primary/20 rounded-[2.5rem] p-0 overflow-hidden outline-none">
        <DialogHeader className="sr-only">
          <DialogTitle>{token.name} Asset Hub</DialogTitle>
          <DialogDescription>Manage your {token.name} balance and perform transactions like send, receive, and swap.</DialogDescription>
        </DialogHeader>
        
        <div className="p-8 bg-gradient-to-b from-primary/10 to-transparent border-b border-white/5 flex flex-col items-center text-center gap-4">
          <div className="w-20 h-20 rounded-[1.5rem] bg-secondary/50 overflow-hidden flex items-center justify-center p-2 border border-white/10 shadow-xl">
            <Image 
              src={token.logoURI} 
              alt={token.name} 
              width={80} 
              height={80} 
              className="rounded-lg" 
              data-ai-hint={token.imageHint}
            />
          </div>
          <div>
            <h3 className="text-2xl font-headline font-bold">{token.name}</h3>
            <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider">{token.balance} {token.symbol}</p>
          </div>
          <div className="flex items-center gap-2 px-3 py-1 bg-green-500/10 rounded-full border border-green-500/20">
            <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            <span className="text-[10px] font-bold text-green-500 uppercase tracking-widest">{token.change}</span>
          </div>
        </div>

        <div className="p-6 space-y-6">
          <div className="grid grid-cols-3 gap-3">
            <Button 
              className="flex-1 h-20 rounded-2xl bg-primary/10 hover:bg-primary/20 border border-primary/20 text-primary flex flex-col gap-2 transition-all group"
              onClick={() => { onClose(); openSend(token); }}
            >
              <Send className="w-5 h-5 group-hover:-translate-y-1 group-hover:translate-x-1 transition-transform" />
              <span className="text-[10px] font-bold uppercase">Send</span>
            </Button>
            <Button 
              className="flex-1 h-20 rounded-2xl bg-accent/10 hover:bg-accent/20 border border-accent/20 text-accent flex flex-col gap-2 transition-all group"
              onClick={() => { onClose(); openReceive(); }}
            >
              <ArrowDownLeft className="w-5 h-5 group-hover:translate-y-1 group-hover:-translate-x-1 transition-transform" />
              <span className="text-[10px] font-bold uppercase">Receive</span>
            </Button>
            <Link href="/swap" className="flex-1" onClick={onClose}>
              <Button className="w-full h-20 rounded-2xl bg-secondary/30 hover:bg-secondary/50 border border-white/5 text-foreground flex flex-col gap-2 transition-all group">
                <Repeat className="w-5 h-5 group-hover:rotate-180 transition-transform duration-500" />
                <span className="text-[10px] font-bold uppercase">Swap</span>
              </Button>
            </Link>
          </div>

          <div className="glass p-4 rounded-2xl flex items-start gap-3 border-white/5">
            <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Market Value</p>
              <p className="text-sm font-bold">{token.value} <span className="text-[10px] text-muted-foreground ml-1">USD</span></p>
            </div>
          </div>

          <div className="flex items-center justify-center gap-2 text-[9px] text-muted-foreground uppercase font-bold tracking-widest opacity-60">
            <ShieldCheck className="w-3 h-3" />
            Verified Asset Node
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
