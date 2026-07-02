
"use client"

import { useState, useEffect } from "react";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle,
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Globe, ShieldCheck, Zap, X, Check, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface WalletConnectHandlerProps {
  uri: string;
  onClose: () => void;
}

export function WalletConnectHandler({ uri, onClose }: WalletConnectHandlerProps) {
  const [step, setStep] = useState<'analyzing' | 'request' | 'connected'>('analyzing');
  const [dappInfo, setDappInfo] = useState({
    name: "Decentralized App",
    url: "https://dapp-service.io",
    description: "External dApp requesting connection via WalletConnect v2",
    icon: "https://picsum.photos/seed/dapp/64/64"
  });

  useEffect(() => {
    // Simulasi parsing URI WalletConnect v2
    const timer = setTimeout(() => {
      setStep('request');
      // Simulasi ekstraksi metadata (dalam realitas ini diambil dari relay)
      if (uri.includes('uniswap')) {
        setDappInfo({
          name: "Uniswap Interface",
          url: "app.uniswap.org",
          description: "Swap tokens and provide liquidity on Ethereum.",
          icon: "https://picsum.photos/seed/uniswap/64/64"
        });
      }
    }, 1500);
    return () => clearTimeout(timer);
  }, [uri]);

  const handleApprove = () => {
    setStep('analyzing');
    setTimeout(() => {
      setStep('connected');
      toast({
        title: "Session Established",
        description: `Connected to ${dappInfo.name} via WalletConnect v2.`,
      });
      setTimeout(onClose, 2000);
    }, 1500);
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[400px] bg-background border-primary/20 rounded-[2.5rem] p-0 overflow-hidden outline-none">
        <DialogHeader className="sr-only">
          <DialogTitle>WalletConnect Session</DialogTitle>
          <DialogDescription>Manage your connection requests with external decentralized applications.</DialogDescription>
        </DialogHeader>

        {step === 'analyzing' && (
          <div className="p-12 flex flex-col items-center text-center gap-6">
            <div className="relative">
              <div className="w-20 h-20 rounded-3xl bg-primary/10 flex items-center justify-center border border-primary/20">
                <Loader2 className="w-10 h-10 text-primary animate-spin" />
              </div>
              <div className="absolute -top-2 -right-2">
                <Zap className="w-6 h-6 text-accent animate-pulse" />
              </div>
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-headline font-bold">Syncing Protocol</h3>
              <p className="text-[10px] text-muted-foreground uppercase tracking-[0.3em] animate-pulse">Establishing v2 Relay</p>
            </div>
          </div>
        )}

        {step === 'request' && (
          <div className="animate-in fade-in zoom-in-95 duration-300">
            <div className="p-8 bg-gradient-to-b from-primary/10 to-transparent border-b border-white/5">
              <div className="flex flex-col items-center text-center gap-4">
                <div className="w-20 h-20 rounded-3xl bg-secondary overflow-hidden shadow-xl border border-white/10">
                  <img src={dappInfo.icon} alt={dappInfo.name} className="w-full h-full object-cover" />
                </div>
                <div>
                  <h3 className="text-2xl font-headline font-bold">{dappInfo.name}</h3>
                  <div className="flex items-center justify-center gap-1.5 mt-1 text-primary">
                    <Globe className="w-3.5 h-3.5" />
                    <span className="text-xs font-medium">{dappInfo.url}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-6">
              <div className="space-y-3">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Requested Permissions</p>
                <div className="space-y-2">
                  {[
                    "View your wallet balance and activity",
                    "Request approval for transactions",
                    "Suggest new chains to add"
                  ].map((perm, i) => (
                    <div key={i} className="flex items-start gap-3 bg-secondary/30 p-3 rounded-xl border border-white/5">
                      <div className="mt-1 w-3.5 h-3.5 rounded-full bg-primary/20 flex items-center justify-center">
                        <Check className="w-2 h-2 text-primary" />
                      </div>
                      <span className="text-[11px] leading-tight text-foreground/80">{perm}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-4 bg-yellow-500/5 border border-yellow-500/10 rounded-2xl flex items-start gap-3">
                <ShieldCheck className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Always verify the dApp URL. Eastchain does not share your secret phrase, only your public address.
                </p>
              </div>

              <div className="flex gap-3">
                <Button variant="outline" className="flex-1 h-14 rounded-2xl font-bold border-white/10" onClick={onClose}>
                  <X className="w-4 h-4 mr-2" /> Reject
                </Button>
                <Button className="flex-1 h-14 rounded-2xl bg-primary text-white font-bold shadow-lg shadow-primary/20" onClick={handleApprove}>
                  <Check className="w-4 h-4 mr-2" /> Approve
                </Button>
              </div>
            </div>
          </div>
        )}

        {step === 'connected' && (
          <div className="p-12 flex flex-col items-center text-center gap-6 animate-in fade-in zoom-in-95 duration-500">
            <div className="w-24 h-24 rounded-full bg-green-500/20 flex items-center justify-center border-4 border-green-500/30">
              <div className="w-16 h-16 rounded-full bg-green-500 flex items-center justify-center text-white shadow-lg shadow-green-500/20">
                <Check className="w-8 h-8 stroke-[3px]" />
              </div>
            </div>
            <div className="space-y-2">
              <h3 className="text-2xl font-headline font-bold">Successfully Paired</h3>
              <p className="text-xs text-muted-foreground">Redirecting back to your vault...</p>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
