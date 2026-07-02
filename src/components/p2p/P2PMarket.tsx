"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  User, 
  CheckCircle2, 
  ChevronDown, 
  Filter,
  PlusCircle,
  AlertCircle,
  Trophy,
  ShieldAlert,
  Send,
  Gavel,
  Image as ImageIcon,
  X
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import { ScrollArea } from "@/components/ui/scroll-area";

export interface P2PAd {
  id: string;
  trader: string;
  isVerified: boolean;
  orders: number;
  completion: string;
  reputation: number;
  price: number;
  available: number;
  limitMin: number;
  limitMax: number;
  paymentMethods: { name: string, color: string }[];
  status: 'active' | 'limited';
  type: 'buy' | 'sell';
}

export interface TradeOrder {
  id: string;
  adId: string;
  price: number;
  amount: number;
  side: 'buy' | 'sell';
  status: 'escrow_locked' | 'payment_sent' | 'disputed' | 'completed';
  timestamp: number;
  trader: string;
}

interface P2PMarketProps {
  tradingPair: string;
  ads: P2PAd[];
  onAddAd: (ad: P2PAd) => void;
  activeOrders: TradeOrder[];
  onAddOrder: (order: TradeOrder) => void;
}

export function P2PMarket({ tradingPair, ads, onAddAd, activeOrders, onAddOrder }: P2PMarketProps) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<'buy' | 'sell'>('buy');
  const [isAdDialogOpen, setIsAdDialogOpen] = useState(false);

  const [newAdPrice, setNewAdPrice] = useState("");
  const [newAdAmount, setNewAdAmount] = useState("");
  const [newAdType, setNewAdType] = useState<"buy" | "sell">("sell");

  const handleExecuteTrade = (ad: P2PAd) => {
    const newOrder: TradeOrder = {
      id: `ORD-${Date.now().toString().slice(-6)}`,
      adId: ad.id,
      price: ad.price,
      amount: 100,
      side: activeTab,
      status: 'escrow_locked',
      timestamp: Date.now(),
      trader: ad.trader
    };
    onAddOrder(newOrder);
    toast({ title: "Trade Locked in Escrow", description: `Order with ${ad.trader} is secured by smart contract.` });
  };

  const handlePostAd = () => {
    const newAd: P2PAd = {
      id: Date.now().toString(),
      trader: "MY_ACCOUNT_PRO",
      isVerified: true,
      orders: 0,
      completion: "100%",
      reputation: 850,
      price: parseFloat(newAdPrice),
      available: parseFloat(newAdAmount),
      limitMin: 1,
      limitMax: 10000,
      type: newAdType,
      paymentMethods: [{ name: "GLOBAL PAY", color: "text-primary" }],
      status: 'active'
    };
    onAddAd(newAd);
    setIsAdDialogOpen(false);
  };

  const filteredAds = ads.filter(ad => activeTab === 'buy' ? ad.type === 'sell' : ad.type === 'buy');

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      <div className="px-4 pt-3 pb-2 border-b border-border bg-card/30 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-5">
            <h2 className="text-base font-black italic tracking-tighter uppercase text-foreground">P2P MARKET</h2>
            <div className="flex items-center gap-4 text-xs font-bold uppercase tracking-widest">
              <button onClick={() => setActiveTab('buy')} className={`pb-1 border-b-2 ${activeTab === 'buy' ? 'text-primary border-primary' : 'text-muted-foreground border-transparent'}`}>Buy</button>
              <button onClick={() => setActiveTab('sell')} className={`pb-1 border-b-2 ${activeTab === 'sell' ? 'text-primary border-primary' : 'text-muted-foreground border-transparent'}`}>Sell</button>
            </div>
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {filteredAds.map((ad, index) => (
          <div key={ad.id} className="px-4 py-3 border-b border-border hover:bg-secondary/10 relative">
            <div className="flex justify-between items-start mb-2">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-black uppercase text-foreground">{ad.trader}</span>
                {ad.isVerified && <CheckCircle2 className="w-3 h-3 text-blue-400" />}
                {index === 0 && <Badge className="h-3.5 bg-yellow-500/20 text-yellow-500 border-none text-[7px] font-black"><Trophy className="w-2 h-2 mr-1" /> TOP SCORE</Badge>}
              </div>
            </div>
            <div className="flex justify-between items-end">
              <div>
                <div className="text-xl font-data font-black text-foreground">${ad.price.toFixed(4)}</div>
                <div className="text-[9px] text-muted-foreground font-bold">{ad.available} EAST Available</div>
              </div>
              <Button onClick={() => handleExecuteTrade(ad)} className={`h-8 px-6 font-black text-[10px] ${activeTab === 'buy' ? "bg-chart-2" : "bg-chart-3"}`}>{activeTab === 'buy' ? 'BUY' : 'SELL'}</Button>
            </div>
          </div>
        ))}
        <div className="p-6 text-center">
          <Dialog open={isAdDialogOpen} onOpenChange={setIsAdDialogOpen}>
            <DialogTrigger asChild><Button variant="outline" className="rounded-full text-[10px] font-black uppercase tracking-wider"><PlusCircle className="w-3.5 h-3.5 mr-2" /> POST P2P AD</Button></DialogTrigger>
            <DialogContent className="bg-card border-border sm:max-w-[360px]">
              <DialogHeader><DialogTitle className="text-lg font-black uppercase text-primary">CREATE ADVERTISEMENT</DialogTitle></DialogHeader>
              <div className="space-y-4 py-2">
                <RadioGroup value={newAdType} onValueChange={(v: any) => setNewAdType(v)} className="grid grid-cols-2 gap-2">
                  <div onClick={() => setNewAdType('sell')} className={`p-2 rounded border cursor-pointer ${newAdType === 'sell' ? 'border-chart-2 bg-chart-2/10' : 'border-transparent bg-secondary/30'}`}><Label className="text-[10px] font-black cursor-pointer">SELL</Label></div>
                  <div onClick={() => setNewAdType('buy')} className={`p-2 rounded border cursor-pointer ${newAdType === 'buy' ? 'border-chart-3 bg-chart-3/10' : 'border-transparent bg-secondary/30'}`}><Label className="text-[10px] font-black cursor-pointer">BUY</Label></div>
                </RadioGroup>
                <div className="space-y-1"><Label className="text-[8px] font-black uppercase">Price per EAST</Label><Input placeholder="1.2450" className="bg-secondary/50" value={newAdPrice} onChange={(e) => setNewAdPrice(e.target.value)} type="number" /></div>
                <div className="space-y-1"><Label className="text-[8px] font-black uppercase">Quantity</Label><Input placeholder="100.00" className="bg-secondary/50" value={newAdAmount} onChange={(e) => setNewAdAmount(e.target.value)} type="number" /></div>
                <Button onClick={handlePostAd} className="w-full bg-primary text-white font-black text-[10px] uppercase">CONFIRM PUBLICATION</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  );
}

export function DisputeForum({ order }: { order: TradeOrder }) {
  const [messages, setMessages] = useState<{ role: string; text: string; time: string; image?: string }[]>([
    { role: 'system', text: 'Escrow locked by EAST smart contract. Validators assigned.', time: 'System 12:00' }
  ]);
  const [input, setInput] = useState("");
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSend = () => {
    if (!input.trim() && !selectedImage) return;
    const now = new Date();
    const timeStr = `You ${now.getHours()}:${now.getMinutes().toString().padStart(2, '0')}`;
    setMessages(prev => [...prev, { role: 'user', text: input, time: timeStr, image: selectedImage || undefined }]);
    setInput("");
    setSelectedImage(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setSelectedImage(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  return (
    <Dialog>
      <DialogTrigger asChild><Button variant="outline" className="flex-1 h-9 text-[10px] font-black uppercase text-destructive border-destructive/20"><ShieldAlert className="w-3.5 h-3.5 mr-2" /> Dispute Forum</Button></DialogTrigger>
      <DialogContent className="bg-card border-border sm:max-w-[500px] h-[600px] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="p-6 bg-destructive/5 border-b border-border flex items-center gap-3"><Gavel className="w-5 h-5 text-destructive" /><DialogTitle className="text-lg font-black uppercase">Trade Dispute Forum</DialogTitle></DialogHeader>
        <div className="flex-1 p-6 overflow-hidden">
          <ScrollArea className="h-full pr-4">
            <div className="space-y-4">
              {messages.map((m, i) => (
                <div key={i} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className={`max-w-[85%] p-3 rounded-xl text-xs ${m.role === 'system' ? 'bg-secondary/30 italic' : 'bg-secondary text-foreground border border-border'}`}>
                    {m.image && <img src={m.image} alt="Evidence" className="mb-2 rounded-lg max-h-48 w-full object-cover" />}
                    {m.text && <p>{m.text}</p>}
                  </div>
                  <span className="text-[8px] font-black text-muted-foreground mt-1 uppercase">{m.time}</span>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
        <div className="p-6 border-t border-border bg-card/50">
          {selectedImage && <div className="mb-2 relative w-16 h-16 rounded-lg border border-primary overflow-hidden"><img src={selectedImage} alt="Preview" className="w-full h-full object-cover" /><button onClick={() => setSelectedImage(null)} className="absolute top-0 right-0 bg-destructive text-white p-0.5"><X className="w-3 h-3" /></button></div>}
          <div className="flex gap-2">
            <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileChange} />
            <Button variant="ghost" size="icon" onClick={() => fileInputRef.current?.click()} className="bg-secondary/50 border border-border"><ImageIcon className="w-4 h-4 text-muted-foreground" /></Button>
            <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Explain the conflict to validators..." className="flex-1 bg-secondary/50" onKeyDown={(e) => e.key === 'Enter' && handleSend()} />
            <Button onClick={handleSend} size="icon" className="bg-primary"><Send className="w-4 h-4 text-white" /></Button>
          </div>
          <p className="text-[9px] text-muted-foreground mt-2 font-black uppercase tracking-tight flex items-center gap-1.5"><ShieldAlert className="w-3 h-3 text-destructive" /> Records are immutable on EAST network.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}