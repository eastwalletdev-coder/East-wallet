"use client"

import { useState, useEffect, useCallback } from "react";
import { WalletGuardian } from "@/components/WalletGuardian";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, Wallet as WalletIcon, Loader2, ShieldAlert, TrendingUp, History, Coins, Zap, ChevronDown, Globe, ShieldCheck, Search, Link2, Settings2, Eye, EyeOff, PlusCircle, Sparkles, Lock, ArrowUpRight, ArrowDownLeft, Clock } from "lucide-react";
import { SettingsSheet } from "@/components/SettingsSheet";
import { useWallet } from "@/lib/wallet-context";
import { useRPC } from "@/lib/rpc-context";
import { DashboardChart } from "@/components/DashboardChart";
import { SendDialog } from "@/components/SendDialog";
import { ReceiveDialog } from "@/components/ReceiveDialog";
import { scanTokensForAddress, type Token } from "@/lib/token-service";
import { getEastTransactions, getPendingEastTransactions, type Transaction, type PendingTransaction } from "@/lib/transaction-service";
import { listLocalActivity, listAllLocalActivity, type LocalActivity } from "@/lib/chain-activity-local";
import { AIScout } from "@/components/AIScout";
import { ContractAnalyzer } from "@/components/ContractAnalyzer";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu as ShadDropdownMenu, DropdownMenuContent as ShadDropdownMenuContent, DropdownMenuItem as ShadDropdownMenuItem, DropdownMenuTrigger as ShadDropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { WalletConnectHandler } from "@/components/WalletConnectHandler";
import { WalletConnectRequestHandler } from "@/components/WalletConnectRequestHandler";
import { QrCameraScanner } from "@/components/QrCameraScanner";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { ImportTokenDialog } from "@/components/ImportTokenDialog";
import { TokenActionHub } from "@/components/TokenActionHub";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";

export default function WalletPage() {
  return (
    <WalletGuardian>
      <WalletPageContent />
    </WalletGuardian>
  );
}

function WalletPageContent() {
  const { accounts, mnemonic, createWallet, isLoading } = useWallet();
  const { selectedChain, setSelectedChain, currentRPC, nodes } = useRPC();
  const [tokens, setTokens] = useState<Token[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [pendingTransactions, setPendingTransactions] = useState<PendingTransaction[]>([]);
  const [localActivity, setLocalActivity] = useState<LocalActivity[]>([]);
  const [txLoading, setTxLoading] = useState(false);
  const [tokensLoading, setTokensLoading] = useState(false);
  const [isManageMode, setIsManageMode] = useState(false);
  const [hiddenTokens, setHiddenTokens] = useState<string[]>([]);
  const [selectedToken, setSelectedToken] = useState<Token | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [startWithScanner, setStartWithScanner] = useState(false);
  
  const [setupPassword, setSetupPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showSetup, setShowSetup] = useState(false);

  const evmAccount = accounts.find(a => a.chain === 'Ethereum');
  // East / Base / BSC share the same EVM derivation address as Ethereum
  const activeAccount =
    selectedChain === 'Solana'
      ? (accounts.find(a => a.chain === 'Solana') || accounts[0])
      : (evmAccount || accounts[0]);

  const performAutoDetection = useCallback(async () => {
    if (!activeAccount?.address) return;
    
    setTokensLoading(true);
    try {
      const detectedTokens = await scanTokensForAddress(activeAccount.address, selectedChain, currentRPC?.url);
      setTokens(detectedTokens);
    } catch (error) {
      console.error("Auto-detection failed", error);
    } finally {
      setTokensLoading(false);
    }
  }, [activeAccount?.address, selectedChain, currentRPC?.url]);

  useEffect(() => {
    if (mnemonic && activeAccount?.address) {
      performAutoDetection();
    }
  }, [mnemonic, selectedChain, activeAccount?.address, performAutoDetection]);

  // Recent activity (same sources as Home): mempool pending + local on-chain + ledger history
  useEffect(() => {
    if (!activeAccount?.address) return;
    let cancelled = false;
    const addr = activeAccount.address;

    async function loadActivity() {
      setTxLoading(true);
      try {
        const [hist, pending] = await Promise.all([
          getEastTransactions(addr, 30),
          getPendingEastTransactions(addr),
        ]);
        if (cancelled) return;
        setTransactions(hist);
        setPendingTransactions(pending);
        setLocalActivity(listAllLocalActivity());
      } finally {
        if (!cancelled) setTxLoading(false);
      }
    }

    loadActivity();
    const onAct = () => setLocalActivity(listAllLocalActivity());
    if (typeof window !== "undefined") {
      window.addEventListener("east-chain-activity", onAct as EventListener);
      window.addEventListener("focus", onAct);
    }
    const interval = setInterval(loadActivity, pendingTransactions.length > 0 ? 5_000 : 20_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
      if (typeof window !== "undefined") {
        window.removeEventListener("east-chain-activity", onAct as EventListener);
        window.removeEventListener("focus", onAct);
      }
    };
  }, [activeAccount?.address, selectedChain, mnemonic, pendingTransactions.length]);

  const toggleTokenVisibility = (symbol: string) => {
    setHiddenTokens(prev => 
      prev.includes(symbol) ? prev.filter(s => s !== symbol) : [...prev, symbol]
    );
  };

  const [wcUriDialogOpen, setWcUriDialogOpen] = useState(false);
  const [wcScanMode, setWcScanMode] = useState(true);
  const [wcUriInput, setWcUriInput] = useState('');
  const [activeWcUri, setActiveWcUri] = useState<string | null>(null);

  const handleWalletConnectClick = () => {
    setWcUriInput('');
    setWcScanMode(true);
    setWcUriDialogOpen(true);
  };

  const handleWcConnect = () => {
    const uri = wcUriInput.trim();
    if (!uri.startsWith('wc:')) {
      toast({ variant: 'destructive', title: 'Invalid URI', description: 'Paste a URI starting with "wc:" from the dApp\'s WalletConnect QR code.' });
      return;
    }
    setWcUriDialogOpen(false);
    setActiveWcUri(uri);
  };

  const getRpcUrlForChain = useCallback((chain: string): string | undefined => {
    const online = nodes.find(n => n.chain === chain && n.status === 'online');
    return (online || nodes.find(n => n.chain === chain))?.url;
  }, [nodes]);

  const handleCreateWallet = () => {
    if (!setupPassword || setupPassword !== confirmPassword) {
      toast({
        variant: "destructive",
        title: "Validation Error",
        description: "Passwords must match and cannot be empty.",
      });
      return;
    }
    if (setupPassword.length < 8) {
      toast({
        variant: "destructive",
        title: "Password Too Short",
        description: "Use at least 8 characters.",
      });
      return;
    }
    createWallet(setupPassword);
  };

  const filteredTokens = tokens.filter(t => 
    (t.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    t.symbol.toLowerCase().includes(searchQuery.toLowerCase())) &&
    (isManageMode || !hiddenTokens.includes(t.symbol))
  );

  const totalNetWorth = tokens.reduce((acc, t) => {
    const val = parseFloat(t.value.replace('$', '').replace(',', ''));
    return isNaN(val) ? acc : acc + val;
  }, 0);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 p-6 text-center">
        <div className="relative">
          <Loader2 className="w-10 h-10 text-primary animate-spin" />
          <Sparkles className="absolute -top-1 -right-1 w-4 h-4 text-accent animate-pulse" />
        </div>
        <div className="space-y-1">
          <p className="text-[10px] text-primary font-bold uppercase tracking-[0.3em]">Synchronizing Wallet</p>
          <p className="text-[8px] text-muted-foreground uppercase font-medium">Accessing multi-chain registry...</p>
        </div>
      </div>
    );
  }

  if (!mnemonic) {
    return (
      <div className="flex flex-col gap-10 p-6 items-center justify-center min-h-[75vh] text-center animate-in fade-in duration-700">
        <div className="relative">
          <div className="w-24 h-24 rounded-[2.5rem] bg-primary/10 flex items-center justify-center border border-primary/20 shadow-[0_0_40px_-5px_rgba(139,92,246,0.3)]">
            <WalletIcon className="w-12 h-12 text-primary" />
          </div>
          <div className="absolute -bottom-2 -right-2 p-2 bg-background border border-white/10 rounded-xl shadow-lg">
            <Lock className="w-4 h-4 text-primary" />
          </div>
        </div>
        
        {showSetup ? (
          <div className="w-full max-w-[320px] space-y-8 animate-in slide-in-from-bottom-6 duration-500">
            <div className="space-y-2">
              <h2 className="text-3xl font-headline font-bold">Setup Security</h2>
              <p className="text-xs text-muted-foreground leading-relaxed">This password will encrypt your local wallet and authorize transactions on this device.</p>
            </div>
            <div className="space-y-4">
              <div className="space-y-3 text-left">
                <Input 
                  type="password" 
                  placeholder="Create Password" 
                  value={setupPassword}
                  onChange={(e) => setSetupPassword(e.target.value)}
                  className="h-14 bg-secondary/30 rounded-2xl border-white/5 px-6"
                />
                <Input 
                  type="password" 
                  placeholder="Confirm Password" 
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="h-14 bg-secondary/30 rounded-2xl border-white/5 px-6"
                />
              </div>
              <Button 
                onClick={handleCreateWallet}
                className="w-full h-16 rounded-[2rem] bg-primary text-primary-foreground font-bold text-lg shadow-xl shadow-primary/20"
              >
                Establish New Vault
              </Button>
              <Button variant="ghost" onClick={() => setShowSetup(false)} className="text-[10px] font-bold uppercase tracking-[0.3em] opacity-50 hover:opacity-100">
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <h1 className="text-4xl font-headline font-bold">No Wallet Active</h1>
              <p className="text-sm text-muted-foreground max-w-[280px] mx-auto leading-relaxed">
                Connect to the decentralized network by creating a new secure vault or importing your secret phrase.
              </p>
            </div>
            <div className="flex flex-col gap-4 w-full max-w-[300px]">
              <Button 
                onClick={() => setShowSetup(true)}
                className="h-16 rounded-[2rem] bg-primary text-primary-foreground font-bold text-lg shadow-xl shadow-primary/20"
              >
                Create New Wallet
              </Button>
              <SettingsSheet>
                <Button variant="outline" className="h-16 rounded-[2rem] border-primary/20 text-primary font-bold text-lg bg-primary/5">
                  Import Secret Phrase
                </Button>
              </SettingsSheet>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-bold uppercase tracking-[0.4em] mt-6 opacity-40">
              <ShieldCheck className="w-4 h-4" />
              100% Non-Custodial
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6 pb-40 animate-in fade-in duration-500">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-headline font-bold text-3xl mb-1">Wallet</h1>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            <p className="text-muted-foreground text-[10px] uppercase tracking-widest font-bold">Self-Custodial Node</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <ShadDropdownMenu>
            <ShadDropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 rounded-xl border-primary/20 bg-primary/5 text-white font-bold text-[10px] uppercase gap-2 hover:bg-primary/10">
                <Globe className="w-3.5 h-3.5" />
                {selectedChain === 'East' ? 'East' : selectedChain}
                <ChevronDown className="w-3.5 h-3.5" />
              </Button>
            </ShadDropdownMenuTrigger>
            <ShadDropdownMenuContent align="end" className="w-40 bg-background/95 backdrop-blur-md border-primary/20 rounded-xl">
              {['East', 'Ethereum', 'Base', 'Solana', 'BSC'].map((chain) => (
                <ShadDropdownMenuItem 
                  key={chain} 
                  onClick={() => setSelectedChain(chain as any)}
                  className={cn(
                    "text-[10px] font-bold uppercase tracking-wider py-2.5 cursor-pointer",
                    selectedChain === chain ? "text-primary bg-primary/10" : "text-white"
                  )}
                >
                  {chain === 'East' ? 'East' : chain === 'BSC' ? 'Binance SC' : chain}
                </ShadDropdownMenuItem>
              ))}
            </ShadDropdownMenuContent>
          </ShadDropdownMenu>
          <SettingsSheet />
        </div>
      </header>

      <section className="glass p-6 rounded-[2.5rem] border-primary/20 relative overflow-hidden bg-gradient-to-br from-primary/10 via-background to-accent/5">
        <div className="relative z-10">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-1.5">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em]">Net Worth</p>
              <Badge variant="outline" className="h-4 text-[7px] border-primary/20 text-primary px-1.5 font-bold uppercase">Private Wallet</Badge>
            </div>
            <span className="text-[9px] font-mono text-muted-foreground opacity-60">
              {activeAccount?.address ? `${activeAccount.address.slice(0, 6)}...${activeAccount.address.slice(-4)}` : "0x..."}
            </span>
          </div>
          <div className="flex items-baseline gap-2 mb-2">
            <h2 className="text-4xl font-headline font-bold">
              ${totalNetWorth.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </h2>
            <Badge className="bg-green-500/10 text-green-500 border-none font-bold text-[10px]">
              {totalNetWorth > 0 ? '+4.2%' : '0.0%'}
            </Badge>
          </div>
          <DashboardChart />
          
          <div className="flex gap-3 mt-6">
            <SendDialog open={sendOpen} onOpenChange={(open) => { setSendOpen(open); if(!open) setStartWithScanner(false); }} startWithScanner={startWithScanner} selectedToken={selectedToken} />
            <ReceiveDialog address={activeAccount?.address || "0x..."} open={receiveOpen} onOpenChange={setReceiveOpen} />
          </div>
        </div>
      </section>

      <div className="px-1">
        <Button 
          variant="outline" 
          onClick={handleWalletConnectClick}
          className="w-full h-12 rounded-2xl border-dashed border-primary/30 bg-primary/5 hover:bg-primary/10 transition-all flex items-center justify-center gap-3 group"
        >
          <div className="p-1.5 bg-primary/10 rounded-lg group-hover:scale-110 transition-transform">
            <Link2 className="w-4 h-4 text-primary" />
          </div>
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white">Scan WalletConnect v2</span>
        </Button>
      </div>

      <Tabs defaultValue="activity" className="w-full">
        <TabsList className="w-full grid grid-cols-2 bg-secondary/30 rounded-xl mb-6 p-1 h-12">
          <TabsTrigger value="assets" className="text-[10px] font-bold uppercase tracking-wider rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Assets</TabsTrigger>
          <TabsTrigger value="activity" className="text-[10px] font-bold uppercase tracking-wider rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="assets" className="space-y-6 outline-none">
          <AIScout accounts={accounts} />
          
          <ContractAnalyzer chain={selectedChain} />
          
          <div className="space-y-4">
            <div className="flex items-center justify-between px-2">
              <div className="flex items-center gap-2">
                <Coins className="w-4 h-4 text-primary" />
                <h2 className="font-headline font-bold text-lg">Portfolio Assets</h2>
              </div>
              <div className="flex items-center gap-2">
                <ImportTokenDialog onImport={(newToken) => setTokens(prev => [newToken, ...prev])} />
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className={cn(
                    "h-8 text-[10px] font-bold uppercase gap-1.5 hover:bg-primary/5",
                    isManageMode ? "text-primary" : "text-muted-foreground"
                  )}
                  onClick={() => setIsManageMode(!isManageMode)}
                >
                  <Settings2 className="w-3.5 h-3.5" /> {isManageMode ? 'Done' : 'Manage'}
                </Button>
              </div>
            </div>

            <div className="relative group px-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground group-focus-within:text-primary transition-colors" />
              <Input 
                placeholder="Search portfolio..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 h-10 bg-secondary/20 border-white/5 rounded-xl text-[10px] uppercase font-bold tracking-wider"
              />
            </div>

            {tokensLoading ? (
              <div className="flex flex-col items-center justify-center p-12 gap-3 glass rounded-[2rem] border-primary/10">
                <div className="relative">
                  <Loader2 className="animate-spin text-primary w-8 h-8" />
                  <Sparkles className="absolute -top-1 -right-1 w-3 h-3 text-accent animate-pulse" />
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-primary uppercase font-bold tracking-[0.2em] animate-pulse">Deep Scanning Protocol</p>
                  <p className="text-[8px] text-muted-foreground uppercase font-medium mt-1">Detecting micin holdings...</p>
                </div>
              </div>
            ) : filteredTokens.length > 0 ? (
              <div className="space-y-3">
                {filteredTokens.map((token) => (
                  <div 
                    key={token.symbol} 
                    onClick={() => {
                      if (isManageMode) return;
                      if (token.comingSoon) {
                        toast({ title: 'Coming Soon', description: `${token.chain} support is on the roadmap — EAST is fully live today.` });
                        return;
                      }
                      setSelectedToken(token);
                    }}
                    className={cn(
                      "glass p-4 rounded-2xl flex items-center justify-between group cursor-pointer hover:bg-white/5 transition-all border-white/5",
                      hiddenTokens.includes(token.symbol) && "opacity-40 grayscale-[0.5]",
                      token.comingSoon && "opacity-70"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-secondary/50 overflow-hidden flex items-center justify-center p-1 border border-white/5 relative">
                        <Image 
                          src={token.logoURI} 
                          alt={token.name} 
                          width={40} 
                          height={40} 
                          className="rounded-lg" 
                          data-ai-hint={token.imageHint}
                        />
                        {isManageMode && (
                          <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
                            {hiddenTokens.includes(token.symbol) ? <EyeOff className="w-4 h-4 text-muted-foreground" /> : <Eye className="w-4 h-4 text-primary" />}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <h3 className="font-bold text-sm">{token.symbol}</h3>
                          {token.comingSoon ? (
                            <Badge className="h-3 px-1.5 text-[6px] bg-muted-foreground/20 text-muted-foreground border-none uppercase font-bold">Coming Soon</Badge>
                          ) : null}
                        </div>
                        {/* Unit price + 24h change (left bottom) — EAST unlisted → $0.00 */}
                        <p className="text-[10px] text-muted-foreground font-mono truncate">
                          {token.comingSoon
                            ? 'Not yet available'
                            : (
                              <>
                                <span>{token.unitPrice ?? (token.symbol === 'EAST' ? '$0.00' : '—')}</span>
                                {token.change && token.change !== '+0.00%' && (
                                  <span className={cn(
                                    'ml-1',
                                    token.change.startsWith('+') ? 'text-green-500' : token.change.startsWith('-') ? 'text-red-500' : ''
                                  )}>
                                    {token.change}
                                  </span>
                                )}
                              </>
                            )}
                        </p>
                      </div>
                    </div>
                    
                    {isManageMode ? (
                      <Switch 
                        checked={!hiddenTokens.includes(token.symbol)} 
                        onCheckedChange={() => toggleTokenVisibility(token.symbol)}
                      />
                    ) : (
                      /* Right: amount on top, USD total below (screenshot-style) */
                      <div className="text-right shrink-0 pl-2">
                        <p className="font-bold text-sm font-mono tabular-nums">
                          {token.comingSoon ? '—' : token.balance}
                        </p>
                        <p className="text-[10px] text-muted-foreground font-mono tabular-nums">
                          {token.comingSoon ? '—' : (token.value || '$0.00')}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
                
                <Button 
                  variant="ghost" 
                  onClick={performAutoDetection}
                  className="w-full h-10 rounded-xl border border-dashed border-primary/20 text-[10px] font-bold uppercase text-primary/60 hover:text-primary hover:bg-primary/5 mt-2"
                >
                  <Sparkles className="w-3 h-3 mr-2" /> Re-scan for new assets
                </Button>
              </div>
            ) : (
              <div className="p-8 text-center glass rounded-2xl border-white/5 flex flex-col items-center gap-3">
                <PlusCircle className="w-8 h-8 text-muted-foreground opacity-20" />
                <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest">No assets detected on-chain</p>
                <Button variant="ghost" className="h-8 text-[10px] font-bold text-primary uppercase" onClick={performAutoDetection}>Try Deep Scan</Button>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="activity" className="space-y-4 outline-none">
          <div className="flex items-center justify-between px-2">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-primary" />
              <h2 className="font-headline font-bold text-lg">Recent Activity</h2>
            </div>
            {pendingTransactions.length > 0 && (
              <span className="text-[10px] font-bold text-amber-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                {pendingTransactions.length} pending
              </span>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground px-2">
            EAST on-chain and network history. Pending = in queue; Confirmed = completed.
            {selectedChain !== "East" && selectedChain !== "Ethereum" ? (
              <span className="block mt-1 text-white/40">
                Other networks: token list only — transfer history for ETH/Base/BSC/Solana is not indexed in this build.
              </span>
            ) : null}
          </p>
          <div className="space-y-2">
            {txLoading && transactions.length === 0 && pendingTransactions.length === 0 && localActivity.length === 0 ? (
              <p className="text-[10px] text-muted-foreground text-center py-8">Loading activity…</p>
            ) : transactions.length === 0 && pendingTransactions.length === 0 && localActivity.length === 0 ? (
              <div className="p-8 text-center glass rounded-2xl border-white/5 flex flex-col items-center gap-2">
                <History className="w-8 h-8 text-muted-foreground opacity-20" />
                <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest">No recent activity</p>
                <p className="text-[9px] text-muted-foreground/60 max-w-[260px]">
                  Sends, receives, stakes, and unstakes will appear here.
                </p>
              </div>
            ) : (
              <>
                {pendingTransactions.map((tx) => (
                  <div key={`p-${tx.txHash}`} className="flex items-center justify-between p-4 bg-amber-500/5 rounded-2xl border border-amber-500/20">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0">
                        <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold capitalize text-amber-200">
                          {tx.type} · <span className="text-amber-400">Pending</span>
                        </p>
                        <p className="text-[9px] text-muted-foreground truncate">
                          {tx.submittedAt}
                          {tx.queuePosition > 0 ? ` · queue #${tx.queuePosition}` : ""}
                        </p>
                        <p className="text-[8px] text-muted-foreground/50 font-mono truncate">{tx.txHash}</p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-bold text-amber-400">{tx.amount} EAST</p>
                      <p className="text-[9px] text-muted-foreground font-mono max-w-[100px] truncate">{tx.address}</p>
                    </div>
                  </div>
                ))}
                {localActivity
                  .filter((la) => !transactions.some((x) => x.txHash === la.txHash))
                  .filter((la) => !pendingTransactions.some((x) => x.txHash === la.txHash))
                  .map((tx) => {
                    const isPending = tx.status === "pending";
                    const isFailed = tx.status === "failed";
                    const statusLabel = isPending ? "Pending" : isFailed ? "Failed" : "Confirmed";
                    const statusColor = isPending ? "text-amber-400" : isFailed ? "text-red-400" : "text-green-400";
                    return (
                      <div key={`l-${tx.id}`} className="flex items-center justify-between p-4 bg-secondary/20 rounded-2xl border border-white/5">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                            isPending ? "bg-amber-500/10" :
                            tx.type === "send" ? "bg-red-500/10" :
                            tx.type === "receive" ? "bg-green-500/10" : "bg-primary/10"
                          }`}>
                            {isPending ? <Clock className="w-4 h-4 text-amber-400" /> :
                             tx.type === "send" ? <ArrowUpRight className="w-4 h-4 text-red-400" /> :
                             tx.type === "receive" ? <ArrowDownLeft className="w-4 h-4 text-green-400" /> :
                             tx.type === "migrate" ? <ArrowUpRight className="w-4 h-4 text-primary" /> :
                             <Lock className="w-4 h-4 text-primary" />}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-bold capitalize">
                              {tx.type} · <span className={statusColor}>{statusLabel}</span>
                            </p>
                            <p className="text-[9px] text-muted-foreground">{tx.date} · on-chain</p>
                            {tx.txHash ? (
                              <p className="text-[8px] text-muted-foreground/50 font-mono truncate">{tx.txHash}</p>
                            ) : null}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className={`text-xs font-bold ${tx.type === "send" ? "text-foreground" : "text-green-500"}`}>
                            {tx.amount}
                          </p>
                          <p className="text-[9px] text-muted-foreground font-mono max-w-[100px] truncate">{tx.address}</p>
                        </div>
                      </div>
                    );
                  })}
                {transactions.map((tx) => {
                  const isPending = tx.status === "pending";
                  const isFailed = tx.status === "failed";
                  const statusLabel = isPending ? "Pending" : isFailed ? "Failed" : "Confirmed";
                  const statusColor = isPending ? "text-amber-400" : isFailed ? "text-red-400" : "text-green-400";
                  return (
                    <div key={tx.id} className="flex items-center justify-between p-4 bg-secondary/20 rounded-2xl border border-white/5">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                          tx.type === "send" ? "bg-red-500/10" :
                          tx.type === "receive" ? "bg-green-500/10" : "bg-primary/10"
                        }`}>
                          {tx.type === "send" ? <ArrowUpRight className="w-4 h-4 text-red-400" /> :
                           tx.type === "receive" ? <ArrowDownLeft className="w-4 h-4 text-green-400" /> :
                           tx.type === "migrate" ? <ArrowUpRight className="w-4 h-4 text-primary" /> :
                           <Lock className="w-4 h-4 text-primary" />}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold capitalize">
                            {tx.type} · <span className={statusColor}>{statusLabel}</span>
                          </p>
                          <p className="text-[9px] text-muted-foreground">{tx.date}</p>
                          <p className="text-[8px] text-muted-foreground/50 font-mono truncate">{tx.txHash}</p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`text-xs font-bold ${tx.type === "send" ? "text-foreground" : "text-green-500"}`}>
                          {tx.amount} {tx.token}
                        </p>
                        <p className="text-[9px] text-muted-foreground font-mono max-w-[100px] truncate">{tx.address}</p>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </TabsContent>
</Tabs>

      <div className="p-6 bg-yellow-500/5 rounded-3xl border border-yellow-500/10 space-y-4 mt-4">
        <div className="flex items-center gap-2 text-yellow-500">
          <ShieldAlert className="w-4 h-4" />
          <span className="text-[10px] font-bold uppercase tracking-widest">Non-Custodial Security</span>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          This is a self-custodial wallet. Your keys are stored only on this device. Losing your recovery phrase means losing all access to your funds.
        </p>
      </div>

      <TokenActionHub 
        token={selectedToken} 
        onClose={() => setSelectedToken(null)} 
        openSend={(token) => { setSelectedToken(token); setSendOpen(true); }}
        openReceive={() => setReceiveOpen(true)}
      />

      {/* WalletConnect — scan the dApp's QR directly, or paste the URI manually */}
      <Dialog open={wcUriDialogOpen} onOpenChange={setWcUriDialogOpen}>
        <DialogContent className="bg-background border-primary/20 rounded-[2rem] max-w-[380px]">
          <DialogHeader>
            <DialogTitle className="font-headline uppercase flex items-center gap-2">
              <Link2 className="w-4 h-4 text-primary" /> Connect via WalletConnect
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {wcScanMode ? (
              <>
                <QrCameraScanner
                  filter={(text) => text.startsWith('wc:')}
                  onScan={(uri) => { setWcUriInput(uri); setWcScanMode(false); setWcUriDialogOpen(false); setActiveWcUri(uri); }}
                  onError={(msg) => toast({ variant: 'destructive', title: 'Camera Error', description: msg })}
                />
                <Button variant="ghost" size="sm" className="w-full text-[10px] text-primary" onClick={() => setWcScanMode(false)}>
                  Paste URI manually instead
                </Button>
              </>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  On the dApp, choose "WalletConnect" and copy the URI (usually under the QR code, e.g. "Copy to clipboard"), then paste it here.
                </p>
                <Input
                  placeholder="wc:a1b2c3...@2?relay-protocol=..."
                  value={wcUriInput}
                  onChange={(e) => setWcUriInput(e.target.value)}
                  className="bg-secondary/30 border-primary/10 font-mono text-xs rounded-xl h-11"
                />
                <Button onClick={handleWcConnect} className="w-full h-11 rounded-xl bg-primary font-bold uppercase text-xs">
                  Connect
                </Button>
                <Button variant="ghost" size="sm" className="w-full text-[10px] text-primary" onClick={() => setWcScanMode(true)}>
                  Scan QR instead
                </Button>
              </>
            )}
            {!evmAccount && (
              <p className="text-[10px] text-amber-400">Set up your Ethereum account first — WalletConnect needs an EVM address to offer the dApp.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {activeWcUri && evmAccount && (
        <WalletConnectHandler
          uri={activeWcUri}
          evmAddress={evmAccount.address}
          onClose={() => setActiveWcUri(null)}
        />
      )}

      {/* Persistent listener for requests on any already-connected session
          (sign message / send transaction) — mounted whenever the wallet
          is unlocked, independent of which dialog/tab is currently open. */}
      {mnemonic && <WalletConnectRequestHandler mnemonic={mnemonic} getRpcUrlForChain={getRpcUrlForChain} />}
    </div>
  );
}
