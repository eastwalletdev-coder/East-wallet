"use client"

import { useState } from "react";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PlusCircle, Search, Loader2, Sparkles, ShieldAlert } from "lucide-react";
import { toast } from "@/hooks/use-toast";

export function ImportTokenDialog({ onImport }: { onImport: (token: any) => void }) {
  const [address, setAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const handleImport = () => {
    if (!address) return;
    setLoading(true);
    // Simulated token fetch
    setTimeout(() => {
      const mockToken = {
        name: "Custom Token",
        symbol: "CTK",
        balance: "0.00",
        value: "$0.00",
        change: "+0.00%",
        logoURI: "https://picsum.photos/seed/custom/64/64",
        imageHint: "crypto token",
        chain: "Ethereum"
      };
      onImport(mockToken);
      setLoading(false);
      setOpen(false);
      setAddress("");
      toast({
        title: "Token Imported",
        description: "New asset has been added to your local library.",
      });
    }, 1500);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 text-[10px] font-bold text-primary uppercase gap-1.5 hover:bg-primary/5">
          <PlusCircle className="w-3.5 h-3.5" /> Import
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px] bg-background border-primary/20 rounded-[2.5rem] outline-none">
        <DialogHeader>
          <DialogTitle className="font-headline text-2xl">Import Token</DialogTitle>
        </DialogHeader>
        <div className="space-y-6 py-4">
          <div className="space-y-2">
            <Label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Token Contract Address</Label>
            <div className="relative">
              <Input 
                placeholder="0x..." 
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="bg-secondary/30 border-primary/10 h-12 rounded-xl pr-10 text-xs font-mono" 
              />
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            </div>
          </div>

          <div className="p-4 bg-primary/5 rounded-2xl border border-primary/10 space-y-3">
            <div className="flex items-center gap-2 text-primary">
              <Sparkles className="w-3.5 h-3.5" />
              <span className="text-[10px] font-bold uppercase tracking-widest">Auto-Detection</span>
            </div>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              Eastchain will automatically fetch the symbol and decimals once you provide a valid contract address on the selected chain.
            </p>
          </div>

          <div className="flex items-start gap-3 p-3 bg-yellow-500/5 border border-yellow-500/10 rounded-xl">
            <ShieldAlert className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />
            <p className="text-[9px] text-muted-foreground leading-tight">
              Anyone can create a token, including fake versions of existing ones. Always verify the contract address.
            </p>
          </div>

          <Button 
            className="w-full h-14 bg-primary text-primary-foreground font-bold rounded-2xl text-lg shadow-lg shadow-primary/20"
            onClick={handleImport}
            disabled={loading || !address}
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : "Verify & Import"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
