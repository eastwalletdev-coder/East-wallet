
"use client"

import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Globe, ShieldCheck, X, Check, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import type { WalletKitTypes } from "@reown/walletkit";
import {
  getWalletKit,
  pairWithUri,
  buildNamespacesForApproval,
  approveSessionProposal,
  rejectSessionProposal,
} from "@/lib/walletconnect-service";

interface WalletConnectHandlerProps {
  uri: string;
  evmAddress: string;
  onClose: () => void;
}

const CHAIN_NAMES: Record<string, string> = {
  'eip155:1': 'Ethereum',
  'eip155:8453': 'Base',
  'eip155:56': 'BNB Smart Chain',
};

export function WalletConnectHandler({ uri, evmAddress, onClose }: WalletConnectHandlerProps) {
  const [step, setStep] = useState<'analyzing' | 'request' | 'connected' | 'error'>('analyzing');
  const [errorMsg, setErrorMsg] = useState('');
  const proposalRef = useRef<WalletKitTypes.SessionProposal | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const kit = await getWalletKit();

        const onProposal = (proposal: WalletKitTypes.SessionProposal) => {
          if (cancelled) return;
          proposalRef.current = proposal;
          setStep('request');
        };
        kit.on('session_proposal', onProposal);

        await pairWithUri(uri);
        // If no proposal arrives within a reasonable window, the URI was
        // likely invalid/expired — WalletConnect URIs are short-lived.
        const timeout = setTimeout(() => {
          if (!cancelled && !proposalRef.current) {
            setErrorMsg('No response from the dApp — the QR/link may have expired. Try scanning a fresh one.');
            setStep('error');
          }
        }, 15_000);

        return () => {
          clearTimeout(timeout);
          kit.off('session_proposal', onProposal);
        };
      } catch (err: any) {
        if (!cancelled) {
          setErrorMsg(err?.message || 'Failed to connect to WalletConnect.');
          setStep('error');
        }
      }
    })();

    return () => { cancelled = true; };
  }, [uri]);

  const handleApprove = async () => {
    const proposal = proposalRef.current;
    if (!proposal) return;
    setStep('analyzing');
    try {
      const namespaces = buildNamespacesForApproval(proposal.params, evmAddress);
      await approveSessionProposal(proposal.id, namespaces);
      setStep('connected');
      toast({
        title: "Session Established",
        description: `Connected to ${proposal.params.proposer.metadata.name} via WalletConnect.`,
      });
      setTimeout(onClose, 1800);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to approve the session.');
      setStep('error');
    }
  };

  const handleReject = async () => {
    const proposal = proposalRef.current;
    if (proposal) {
      try { await rejectSessionProposal(proposal.id); } catch { /* best effort */ }
    }
    onClose();
  };

  const metadata = proposalRef.current?.params.proposer.metadata;
  const requestedChains = proposalRef.current
    ? [
        ...(proposalRef.current.params.requiredNamespaces?.eip155?.chains || []),
        ...(proposalRef.current.params.optionalNamespaces?.eip155?.chains || []),
      ]
    : [];

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[400px] bg-background border-primary/20 rounded-[2.5rem] p-0 overflow-hidden outline-none">
        <DialogHeader className="sr-only">
          <DialogTitle>WalletConnect Session</DialogTitle>
          <DialogDescription>Manage your connection requests with external decentralized applications.</DialogDescription>
        </DialogHeader>

        {step === 'analyzing' && (
          <div className="p-12 flex flex-col items-center text-center gap-6">
            <div className="w-20 h-20 rounded-3xl bg-primary/10 flex items-center justify-center border border-primary/20">
              <Loader2 className="w-10 h-10 text-primary animate-spin" />
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-headline font-bold">Connecting</h3>
              <p className="text-[10px] text-muted-foreground uppercase tracking-[0.3em] animate-pulse">Establishing WalletConnect Session</p>
            </div>
          </div>
        )}

        {step === 'error' && (
          <div className="p-12 flex flex-col items-center text-center gap-6">
            <div className="w-20 h-20 rounded-3xl bg-red-500/10 flex items-center justify-center border border-red-500/20">
              <AlertTriangle className="w-10 h-10 text-red-400" />
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-headline font-bold">Connection Failed</h3>
              <p className="text-xs text-muted-foreground px-4">{errorMsg}</p>
            </div>
            <Button variant="outline" className="rounded-2xl" onClick={onClose}>Close</Button>
          </div>
        )}

        {step === 'request' && metadata && (
          <div className="animate-in fade-in zoom-in-95 duration-300">
            <div className="p-8 bg-gradient-to-b from-primary/10 to-transparent border-b border-white/5">
              <div className="flex flex-col items-center text-center gap-4">
                <div className="w-20 h-20 rounded-3xl bg-secondary overflow-hidden shadow-xl border border-white/10">
                  {metadata.icons?.[0] ? (
                    <img src={metadata.icons[0]} alt={metadata.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center"><Globe className="w-8 h-8 text-primary/40" /></div>
                  )}
                </div>
                <div>
                  <h3 className="text-2xl font-headline font-bold">{metadata.name}</h3>
                  <div className="flex items-center justify-center gap-1.5 mt-1 text-primary">
                    <Globe className="w-3.5 h-3.5" />
                    <span className="text-xs font-medium">{metadata.url}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-6">
              <div className="space-y-3">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Requesting Access To</p>
                <div className="flex flex-wrap gap-2">
                  {requestedChains.map((chain) => (
                    <span key={chain} className="text-[10px] px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary font-bold">
                      {CHAIN_NAMES[chain] || chain}
                    </span>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground font-mono px-1">
                  {evmAddress.slice(0, 8)}...{evmAddress.slice(-6)}
                </p>
              </div>

              <div className="p-4 bg-yellow-500/5 border border-yellow-500/10 rounded-2xl flex items-start gap-3">
                <ShieldCheck className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Only your public address is shared. Every transaction or signature this dApp requests will still need your explicit approval, one at a time.
                </p>
              </div>

              <div className="flex gap-3">
                <Button variant="outline" className="flex-1 h-14 rounded-2xl font-bold border-white/10" onClick={handleReject}>
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
              <p className="text-xs text-muted-foreground">You can now approve requests from this dApp as they arrive.</p>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
