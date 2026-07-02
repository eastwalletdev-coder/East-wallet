"use client";

import { useState, useMemo, useEffect } from "react";
import { PriceChart } from "./PriceChart";
import { OrderBook } from "./OrderBook";
import { TradeHistory } from "./TradeHistory";
import { MarketInsights } from "./MarketInsights";
import { OrderForm } from "./OrderForm";
import { P2PMarket, DisputeForum, type P2PAd, type TradeOrder } from "./P2PMarket";
import { 
  ArrowUpRight,
  ChevronDown,
  Activity,
  Layers,
  Users,
  LayoutGrid,
  ClipboardList,
  User as UserIcon,
  LayoutDashboard,
  Settings,
  Info,
  Clock,
  ExternalLink,
  Trash2,
  Moon,
  Sun,
  Send
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const AVAILABLE_PAIRS = ["BTC/USDT", "EAST/USDT"];

const INITIAL_ADS: P2PAd[] = [
  {
    id: "1",
    trader: "MEDINA_STORE",
    isVerified: true,
    orders: 328,
    completion: "82.00%",
    reputation: 750,
    price: 1.2450,
    available: 4500.13,
    limitMin: 10,
    limitMax: 5000,
    type: 'sell',
    paymentMethods: [
      { name: "PAYPAL", color: "text-blue-400" },
      { name: "WISE", color: "text-green-400" }
    ],
    status: 'active'
  },
  {
    id: "2",
    trader: "sansanbidr",
    isVerified: true,
    orders: 2183,
    completion: "87.63%",
    reputation: 980,
    price: 1.2480,
    available: 6100.11,
    limitMin: 5,
    limitMax: 2000,
    type: 'sell',
    paymentMethods: [
      { name: "REVOLUT", color: "text-purple-400" },
      { name: "ZEN", color: "text-orange-400" }
    ],
    status: 'active'
  }
];

export function TradingTerminal() {
  const [tradingPair, setTradingPair] = useState("EAST/USDT");
  const [activeTab, setActiveTab] = useState("p2p");
  const [ads, setAds] = useState<P2PAd[]>(INITIAL_ADS);
  const [activeOrders, setActiveOrders] = useState<TradeOrder[]>([]);
  const [isDarkMode, setIsDarkMode] = useState(true);

  useEffect(() => {
    const savedTheme = (typeof window !== 'undefined' ? localStorage.getItem('theme') : null) || 'dark';
    setIsDarkMode(savedTheme === 'dark');
    if (savedTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, []);

  const toggleTheme = (checked: boolean) => {
    setIsDarkMode(checked);
    if (checked) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  };

  const myAds = useMemo(() => ads.filter(ad => ad.trader === "MY_ACCOUNT_PRO"), [ads]);

  const handleAddOrder = (order: TradeOrder) => {
    setActiveOrders(prev => [order, ...prev]);
  };

  const handleAddAd = (ad: P2PAd) => {
    setAds(prev => [ad, ...prev]);
  };

  const handleDeleteAd = (adId: string) => {
    setAds(prev => prev.filter(ad => ad.id !== adId));
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
      <div className="flex-1 flex overflow-hidden pb-16 lg:pb-0">
        <div className="flex-1 flex flex-col min-w-0 border-r border-border">
          <div className="h-16 px-6 border-b border-border flex items-center justify-between shrink-0 bg-card/30 backdrop-blur-sm">
            <div className="flex items-center gap-6">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-2 font-bold text-lg hover:text-primary transition-colors focus:outline-none bg-secondary/30 px-3 py-1.5 rounded-lg border border-border/50">
                    {tradingPair}
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="bg-popover border-border w-48 shadow-2xl">
                  {AVAILABLE_PAIRS.map((pair) => (
                    <DropdownMenuItem 
                      key={pair} 
                      onClick={() => setTradingPair(pair)}
                      className="cursor-pointer font-bold focus:bg-primary/20 flex justify-between items-center"
                    >
                      {pair}
                      {tradingPair === pair && <Activity className="w-3 h-3 text-primary" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              
              <div className="hidden md:flex gap-8 border-l border-border pl-8">
                <div className="flex flex-col">
                  <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">Mark Price</span>
                  <span className="font-data font-bold text-sm text-chart-2">
                    {tradingPair === "BTC/USDT" ? "41,205.80" : "1.2450"}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">24h Change</span>
                  <div className="flex items-center gap-1 text-chart-2 font-data text-sm">
                    <ArrowUpRight className="w-3 h-3" />
                    <span>{tradingPair === "BTC/USDT" ? "+2.45%" : "+12.8%"}</span>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="hidden lg:flex bg-secondary/50 p-1 rounded-md border border-border/50">
                <button onClick={() => setActiveTab('exchange')} className={`px-3 py-1.5 text-[10px] font-bold rounded flex items-center gap-2 transition-all ${activeTab === 'exchange' ? 'bg-primary text-white' : 'text-muted-foreground'}`}><Layers className="w-3 h-3" /> EXCHANGE</button>
                <button onClick={() => setActiveTab('p2p')} className={`px-3 py-1.5 text-[10px] font-bold rounded flex items-center gap-2 transition-all ${activeTab === 'p2p' ? 'bg-primary text-white' : 'text-muted-foreground'}`}><Users className="w-3 h-3" /> P2P MARKET</button>
                <button onClick={() => setActiveTab('orders')} className={`px-3 py-1.5 text-[10px] font-bold rounded flex items-center gap-2 transition-all ${activeTab === 'orders' ? 'bg-primary text-white' : 'text-muted-foreground'}`}><Clock className="w-3 h-3" /> MY ORDERS {activeOrders.length > 0 && <span className="w-1.5 h-1.5 rounded-full bg-chart-2 ml-1" />}</button>
              </div>
            </div>
          </div>

          <div className="flex-1 flex flex-col min-h-0 relative">
            <div className={`flex-1 flex flex-col ${activeTab === 'exchange' ? 'flex' : 'hidden'}`}>
               <div className="flex-1 relative"><PriceChart /></div>
               <div className="h-[280px] border-t border-border shrink-0 flex flex-col bg-card/5">
                <div className="px-6 h-10 border-b border-border flex items-center justify-between bg-card/10 shrink-0"><span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Recent Market Trades</span></div>
                <div className="flex-1 overflow-hidden"><TradeHistory /></div>
              </div>
            </div>

            <div className={`flex-1 flex flex-col ${activeTab === 'p2p' ? 'flex' : 'hidden'}`}>
               <div className="h-1/3 border-b border-border relative shrink-0">
                  <PriceChart />
                  <div className="absolute top-2 right-4 z-10"><span className="bg-primary/20 text-primary text-[8px] font-bold px-2 py-0.5 rounded-full border border-primary/30 uppercase tracking-tighter">Live Monitor</span></div>
               </div>
               <div className="flex-1 min-h-0"><P2PMarket tradingPair={tradingPair} ads={ads} onAddAd={handleAddAd} activeOrders={activeOrders} onAddOrder={handleAddOrder} /></div>
            </div>

            <div className={`flex-1 flex flex-col bg-background ${activeTab === 'orders' ? 'flex' : 'hidden'}`}>
              <div className="p-6 border-b border-border flex items-center justify-between"><h2 className="text-xl font-black italic tracking-tighter uppercase text-primary">My Active Orders</h2><Badge className="bg-primary/20 text-primary border-none">{activeOrders.length} Trades</Badge></div>
              <ScrollArea className="flex-1">
                <div className="p-6 space-y-4 max-w-2xl mx-auto">
                  {activeOrders.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 opacity-30 gap-4"><Clock className="w-12 h-12" /><p className="text-sm font-bold uppercase tracking-widest">No active trading orders</p><Button variant="outline" onClick={() => setActiveTab('p2p')}>Browse P2P Market</Button></div>
                  ) : (
                    activeOrders.map(order => (
                      <div key={order.id} className="p-4 rounded-xl border border-border bg-secondary/10 group hover:border-primary/50 transition-all">
                        <div className="flex justify-between items-start mb-4">
                          <div className="flex flex-col"><span className="text-[10px] font-black uppercase text-muted-foreground">ID: {order.id}</span><span className="text-sm font-bold">Trade with {order.trader}</span></div>
                          <Badge className="bg-chart-2/20 text-chart-2 border-none text-[9px] uppercase font-black px-2 py-1">{order.status.replace('_', ' ')}</Badge>
                        </div>
                        <div className="grid grid-cols-2 gap-6 mb-4">
                          <div className="flex flex-col gap-1"><span className="text-[9px] text-muted-foreground uppercase font-black tracking-widest">Amount</span><span className="font-data text-sm font-bold">{order.amount.toFixed(2)} EAST</span></div>
                          <div className="flex flex-col items-end gap-1"><span className="text-[9px] text-muted-foreground uppercase font-black tracking-widest">Total Value</span><span className="font-data text-sm font-bold text-primary">{(order.price * order.amount).toFixed(2)} USDT</span></div>
                        </div>
                        <div className="flex gap-2"><Button className="flex-1 h-9 text-[10px] font-black uppercase tracking-widest bg-chart-2 hover:bg-chart-2/90">I Have Paid</Button><DisputeForum order={order} /></div>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>
        </div>

        <div className={`w-[300px] hidden xl:flex flex-col border-r border-border bg-card/40 ${activeTab !== 'exchange' ? 'hidden' : ''}`}><OrderBook tradingPair={tradingPair} /></div>
        <div className={`w-[340px] hidden lg:flex flex-col bg-card/60 ${activeTab !== 'exchange' ? 'hidden' : ''}`}><ScrollArea className="flex-1"><div className="flex flex-col"><OrderForm tradingPair={tradingPair} /><MarketInsights tradingPair={tradingPair} /></div></ScrollArea></div>
      </div>

      <div className="lg:hidden fixed bottom-0 left-0 right-0 h-16 bg-card/80 backdrop-blur-xl border-t border-border flex items-center justify-around z-50 px-2 pb-1">
        <button onClick={() => setActiveTab('p2p')} className={`flex flex-col items-center gap-1 transition-all ${activeTab === 'p2p' ? 'text-primary' : 'text-muted-foreground opacity-60'}`}><LayoutGrid className="w-5 h-5" /><span className="text-[10px] font-bold uppercase">P2P Market</span></button>
        <button onClick={() => setActiveTab('exchange')} className={`flex flex-col items-center gap-1 transition-all ${activeTab === 'exchange' ? 'text-primary' : 'text-muted-foreground opacity-60'}`}><Activity className="w-5 h-5" /><span className="text-[10px] font-bold uppercase">Exchange</span></button>
        <button onClick={() => setActiveTab('orders')} className={`flex flex-col items-center gap-1 transition-all ${activeTab === 'orders' ? 'text-primary' : 'text-muted-foreground opacity-60'}`}><ClipboardList className="w-5 h-5" /><span className="text-[10px] font-bold uppercase">Orders</span></button>
        
        <Sheet>
          <SheetTrigger asChild>
            <button className="flex flex-col items-center gap-1 text-muted-foreground opacity-60 hover:opacity-100 transition-opacity"><UserIcon className="w-5 h-5" /><span className="text-[10px] font-bold uppercase">Profile</span></button>
          </SheetTrigger>
          <SheetContent className="w-[350px] sm:w-[400px] bg-card border-l border-border p-0">
            <SheetHeader className="p-6 border-b border-border bg-primary/5">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center glow-primary"><UserIcon className="w-6 h-6 text-white" /></div>
                <div className="text-left">
                  <div className="flex items-center gap-2"><SheetTitle className="text-lg font-bold">Trader_7129</SheetTitle><Badge className="h-4 bg-chart-2 text-[9px]">VERIFIED</Badge></div>
                  <div className="flex items-center gap-2 mt-0.5"><Send className="w-3 h-3 text-primary" /><span className="text-xs text-muted-foreground">@trader_7129</span></div>
                </div>
              </div>
            </SheetHeader>
            <div className="p-4">
              <Accordion type="single" collapsible className="w-full space-y-3">
                <AccordionItem value="dashboard" className="border border-border rounded-xl px-4 bg-secondary/20">
                  <AccordionTrigger className="hover:no-underline py-4"><div className="flex items-center gap-3"><LayoutDashboard className="w-4 h-4 text-primary" /><span className="text-sm font-bold uppercase tracking-wider">Dashboard</span></div></AccordionTrigger>
                  <AccordionContent className="pb-4 space-y-3">
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div className="bg-background/50 p-3 rounded-lg border border-border"><p className="text-[10px] text-muted-foreground uppercase font-bold">Total Sales</p><p className="font-data text-sm font-bold">5,420 <span className="text-[10px] opacity-60">USDT</span></p></div>
                      <div className="bg-background/50 p-3 rounded-lg border border-border"><p className="text-[10px] text-muted-foreground uppercase font-bold">Win Rate</p><p className="font-data text-sm font-bold text-chart-2">99.4%</p></div>
                    </div>
                    <div className="space-y-2">
                      <h4 className="text-[10px] font-black uppercase text-primary tracking-widest px-1">My Active Ads</h4>
                      {myAds.map(ad => (
                        <div key={ad.id} className="p-3 bg-background/40 rounded-lg border border-border flex justify-between items-center group">
                          <div className="flex flex-col"><span className={`text-[9px] font-black uppercase ${ad.type === 'sell' ? 'text-chart-3' : 'text-chart-2'}`}>{ad.type}ing EAST</span><span className="text-xs font-bold font-data">${ad.price.toFixed(4)}</span></div>
                          <div className="flex items-center gap-2">
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => handleDeleteAd(ad.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-primary"><ExternalLink className="w-3.5 h-3.5" /></Button>
                          </div>
                        </div>
                      ))}
                      <Button className="w-full text-xs font-bold mt-2" variant="outline" onClick={() => setActiveTab('p2p')}>Create New Ad</Button>
                    </div>
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="settings" className="border border-border rounded-xl px-4 bg-secondary/20">
                  <AccordionTrigger className="hover:no-underline py-4"><div className="flex items-center gap-3"><Settings className="w-4 h-4 text-primary" /><span className="text-sm font-bold uppercase tracking-wider">Settings</span></div></AccordionTrigger>
                  <AccordionContent className="pb-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-medium">Dark Mode</Label>
                      <div className="flex items-center gap-2">
                        {isDarkMode ? <Moon className="w-3 h-3 text-primary" /> : <Sun className="w-3 h-3 text-yellow-500" />}
                        <Switch checked={isDarkMode} onCheckedChange={toggleTheme} className="data-[state=checked]:bg-primary" />
                      </div>
                    </div>
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="faq" className="border border-border rounded-xl px-4 bg-secondary/20">
                  <AccordionTrigger className="hover:no-underline py-4"><div className="flex items-center gap-3"><Info className="w-4 h-4 text-primary" /><span className="text-sm font-bold uppercase tracking-wider">FAQ / How it Works</span></div></AccordionTrigger>
                  <AccordionContent className="pb-4 space-y-4 text-[11px]">
                    <div className="space-y-1"><p className="font-bold text-primary italic uppercase tracking-wider">What is EAST P2P?</p><p className="text-muted-foreground leading-relaxed">A high-performance P2P platform that connects buyers and sellers to trade digital assets directly with secure smart-contract escrow.</p></div>
                    <div className="space-y-1"><p className="font-bold text-primary italic uppercase tracking-wider">How does validation work?</p><p className="text-muted-foreground leading-relaxed">Validator nodes online that secure the EAST network also participate in validating P2P marketplace escrow transactions. At least 2 validators must reach consensus for funds to be automatically released. If a conflict arises, a dedicated Dispute Forum is provided for resolution.</p></div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}