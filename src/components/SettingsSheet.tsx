"use client"

import React, { useState } from 'react';
import { 
  Sheet, 
  SheetContent, 
  SheetHeader, 
  SheetTitle, 
  SheetDescription,
  SheetTrigger
} from "@/components/ui/sheet";
import { 
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Settings, Zap, Shield, Eye, Copy, Upload, RefreshCcw, LogOut, Globe, Lock } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useRPC } from "@/lib/rpc-context";
import { useWallet } from "@/lib/wallet-context";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { Input } from '@/components/ui/input';

interface SettingsSheetProps {
  children?: React.ReactNode;
}

export function SettingsSheet({ children }: SettingsSheetProps) {
  const { isAutoMode, setIsAutoMode, currentRPC, nodes, refreshLatencies, setCurrentRPC, selectedChain, setSelectedChain } = useRPC();
  const { mnemonic, importWallet, logout, unlock } = useWallet();
  const [importText, setImportText] = useState("");
  const [importPassword, setImportPassword] = useState("");
  const [isExportVisible, setIsExportVisible] = useState(false);
  const [revealPassword, setRevealPassword] = useState("");
  const [revealError, setRevealError] = useState("");
  const [revealConfirming, setRevealConfirming] = useState(false);

  const handleExport = () => {
    if (!mnemonic) return;
    navigator.clipboard.writeText(mnemonic);
    toast({ title: "Mnemonic Copied" });
  };

  const handleImportAction = async () => {
    if (!importText.trim() || !importPassword.trim()) {
      toast({ variant: "destructive", title: "Missing Fields", description: "Please enter mnemonic and password." });
      return;
    }
    if (importPassword.length < 8) {
      toast({ variant: "destructive", title: "Password Too Short", description: "Use at least 8 characters." });
      return;
    }
    const success = await importWallet(importText, importPassword);
    if (success) {
      setImportText("");
      setImportPassword("");
      toast({ title: "Wallet Imported" });
    } else {
      toast({ variant: "destructive", title: "Invalid Mnemonic" });
    }
  };

  return (
    <Sheet>
      <SheetTrigger asChild>
        {children || (
          <Button variant="ghost" size="icon" className="rounded-full hover:bg-secondary h-11 w-11">
            <Settings className="w-5 h-5 text-muted-foreground" />
          </Button>
        )}
      </SheetTrigger>
      <SheetContent className="w-full max-w-[420px] bg-background border-l border-border overflow-y-auto pb-24 outline-none">
        <SheetHeader className="mb-8 text-left">
          <SheetTitle className="font-headline text-3xl font-bold">Settings Hub</SheetTitle>
          <SheetDescription className="text-[10px] uppercase tracking-[0.2em] font-bold text-primary/60">Professional Node Configuration</SheetDescription>
        </SheetHeader>

        <Accordion type="multiple" className="w-full space-y-6">
          <AccordionItem value="network" className="border-none">
            <AccordionTrigger className="hover:no-underline py-0">
              <div className="flex items-center gap-2 px-1 text-left">
                <Globe className="w-3.5 h-3.5 text-primary" />
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">1. Network Rack</h3>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pt-4 space-y-4">
              <div className="grid grid-cols-2 gap-2">
                {['East', 'Ethereum', 'Base', 'Solana', 'BSC'].map((chain) => (
                  <Button 
                    key={chain}
                    variant="outline"
                    onClick={() => setSelectedChain(chain as any)}
                    className={cn(
                      "h-12 rounded-xl font-bold text-[10px] uppercase transition-all",
                      selectedChain === chain ? "bg-primary text-white border-primary" : "border-primary/10 text-white hover:text-white"
                    )}
                  >
                    {chain === 'BSC' ? 'Binance SC' : chain === 'East' ? 'East' : chain}
                  </Button>
                ))}
              </div>

              <div className="glass p-5 rounded-3xl space-y-5 border-primary/10">
                <div className="flex items-center justify-between pb-4 border-b border-white/5">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-primary/10 rounded-lg">
                      <Zap className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-xs font-bold">Auto-Node Selector</p>
                      <p className="text-[9px] text-muted-foreground uppercase tracking-tighter">Latency Sync</p>
                    </div>
                  </div>
                  <Switch checked={isAutoMode} onCheckedChange={setIsAutoMode} />
                </div>
                
                <div className="space-y-2 max-h-[160px] overflow-y-auto pr-1">
                  {nodes.map((node) => (
                    <div 
                      key={node.id} 
                      onClick={() => setCurrentRPC(node)}
                      className={cn(
                        "flex items-center justify-between p-3 rounded-xl cursor-pointer transition-all border",
                        currentRPC?.id === node.id 
                          ? "bg-primary/10 border-primary/30" 
                          : "bg-white/[0.02] border-transparent hover:border-white/10"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <div className={cn("w-1.5 h-1.5 rounded-full", node.status === 'online' ? "bg-green-500 animate-pulse" : "bg-muted")} />
                        <span className="text-[11px] font-medium">{node.name}</span>
                      </div>
                      <span className={cn("text-[10px] font-mono font-bold", node.status === 'online' ? "text-primary" : "text-muted-foreground")}>
                        {node.latency ? `${node.latency}ms` : 'offline'}
                      </span>
                    </div>
                  ))}
                </div>

                <Button variant="ghost" size="sm" className="w-full h-10 text-[10px] uppercase font-bold text-primary hover:bg-primary/5 rounded-xl" onClick={() => refreshLatencies()}>
                  <RefreshCcw className="w-3.5 h-3.5 mr-2" /> Refresh Nodes
                </Button>
              </div>
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="security" className="border-none">
            <AccordionTrigger className="hover:no-underline py-0">
              <div className="flex items-center gap-2 px-1 text-left">
                <Lock className="w-3.5 h-3.5 text-primary" />
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">2. Security Rack</h3>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pt-4 space-y-4">
              <Tabs defaultValue={mnemonic ? "backup" : "import"} className="w-full">
                <TabsList className="grid w-full grid-cols-2 bg-secondary/20 p-1 rounded-2xl h-12">
                  <TabsTrigger value="backup" className="rounded-xl text-[10px] font-bold uppercase tracking-wider" disabled={!mnemonic}>Backup</TabsTrigger>
                  <TabsTrigger value="import" className="rounded-xl text-[10px] font-bold uppercase tracking-wider">Restore</TabsTrigger>
                </TabsList>
                
                <TabsContent value="backup" className="mt-4 outline-none">
                  <div className="glass p-5 rounded-3xl space-y-5 border-primary/10">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-primary">
                        <Shield className="w-4 h-4" />
                        <p className="text-[10px] font-bold uppercase tracking-wider">Secret Phrase</p>
                      </div>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => setIsExportVisible(!isExportVisible)}>
                        <Eye className="w-4 h-4" />
                      </Button>
                    </div>
                    
                    {isExportVisible ? (
                      <div className="space-y-4">
                        <div className="grid grid-cols-3 gap-2">
                          {mnemonic?.split(' ').map((word, i) => (
                            <div key={i} className="bg-white/5 p-2 rounded-xl text-center border border-white/10">
                              <span className="text-[8px] text-muted-foreground block mb-0.5">{i + 1}</span>
                              <span className="text-[11px] font-mono font-bold text-foreground">{word}</span>
                            </div>
                          ))}
                        </div>
                        <Button variant="ghost" size="sm" className="w-full text-[10px] text-muted-foreground" onClick={() => setIsExportVisible(false)}>
                          Hide Phrase
                        </Button>
                      </div>
                    ) : revealConfirming ? (
                      <div className="space-y-3">
                        <p className="text-[10px] text-muted-foreground text-center">Enter your password to reveal</p>
                        <Input
                          type="password"
                          placeholder="Password"
                          value={revealPassword}
                          onChange={(e) => { setRevealPassword(e.target.value); setRevealError(''); }}
                          className="h-11 bg-secondary/30 rounded-xl border-white/5"
                          autoFocus
                        />
                        {revealError && <p className="text-[10px] text-red-400 text-center">{revealError}</p>}
                        <div className="flex gap-2">
                          <Button variant="ghost" size="sm" className="flex-1 text-[10px]" onClick={() => { setRevealConfirming(false); setRevealPassword(''); setRevealError(''); }}>
                            Cancel
                          </Button>
                          <Button size="sm" className="flex-1 text-[10px] bg-primary" onClick={async () => {
                            const ok = await unlock(revealPassword);
                            if (ok) { setIsExportVisible(true); setRevealConfirming(false); setRevealPassword(''); }
                            else setRevealError('Incorrect password');
                          }}>
                            Confirm
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="h-28 bg-white/[0.03] rounded-2xl flex items-center justify-center border border-dashed border-white/10 cursor-pointer hover:bg-white/5 transition-all group" onClick={() => setRevealConfirming(true)}>
                        <div className="text-center">
                          <Lock className="w-5 h-5 text-muted-foreground mx-auto mb-2 group-hover:text-primary transition-colors" />
                          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Click to reveal keys</p>
                        </div>
                      </div>
                    )}
                    
                    <Button variant="outline" className="w-full h-12 text-xs font-bold gap-2 rounded-xl border-primary/20 text-primary hover:bg-primary hover:text-white" onClick={handleExport} disabled={!mnemonic}>
                      <Copy className="w-3.5 h-3.5" /> Copy Phrase
                    </Button>
                  </div>
                </TabsContent>

                <TabsContent value="import" className="mt-4 outline-none">
                  <div className="glass p-5 rounded-3xl space-y-4 border-primary/10">
                    <textarea 
                      value={importText}
                      onChange={(e) => setImportText(e.target.value)}
                      placeholder="Enter your 12-word recovery phrase..."
                      className="w-full h-24 bg-secondary/30 border border-white/5 rounded-2xl p-4 text-xs font-mono focus:ring-1 focus:ring-primary/50 outline-none resize-none placeholder:text-muted-foreground/50"
                    />
                    <Input 
                      type="password"
                      placeholder="New Password"
                      value={importPassword}
                      onChange={(e) => setImportPassword(e.target.value)}
                      className="h-12 bg-secondary/30 rounded-xl"
                    />
                    <Button className="w-full h-12 font-bold gap-2 rounded-xl bg-primary text-white" onClick={handleImportAction} disabled={!importText.trim() || !importPassword.trim()}>
                      <Upload className="w-3.5 h-3.5" /> Restore Wallet
                    </Button>
                  </div>
                </TabsContent>
              </Tabs>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <div className="mt-8 space-y-4">
          {mnemonic && (
            <Button 
              variant="destructive" 
              className="w-full h-14 font-bold gap-2 bg-destructive/5 text-destructive border border-destructive/20 hover:bg-destructive hover:text-white rounded-2xl"
              onClick={() => {
                if (confirm("Permanently erase keys? Make sure you have a backup!")) {
                  logout();
                  toast({ title: "Logged Out" });
                }
              }}
            >
              <LogOut className="w-4 h-4" /> Erase Local Wallet
            </Button>
          )}

          <div className="text-center py-6 opacity-40">
            <p className="text-[8px] text-muted-foreground uppercase tracking-[0.5em] font-bold">Eastchain v1.1.2-Stable</p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
