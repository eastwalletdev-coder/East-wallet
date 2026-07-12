"use client"

import { useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Check, Loader2, X, FileSignature, Send } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import type { WalletKitTypes } from "@reown/walletkit";
import { getWalletKit, respondToRequest, rejectRequest } from "@/lib/walletconnect-service";
import { getEvmSigner } from "@/lib/wallet-service";
import { formatEther } from "ethers";

interface WalletConnectRequestHandlerProps {
  mnemonic: string | null;
  /** Look up a live RPC URL for a given chain name ('Ethereum'|'Base'|'BSC'). */
  getRpcUrlForChain: (chain: string) => string | undefined;
}

const CHAIN_ID_TO_NAME: Record<string, string> = {
  'eip155:1': 'Ethereum',
  'eip155:8453': 'Base',
  'eip155:56': 'BSC',
};

/**
 * Ongoing (post-pairing) WalletConnect requests — a dApp can ask to sign
 * a message or send a transaction at any point after the initial
 * session_proposal (handled separately in WalletConnectHandler.tsx).
 * Every request still requires explicit approval here, one at a time —
 * approving the session itself never grants blanket signing rights.
 */
export function WalletConnectRequestHandler({ mnemonic, getRpcUrlForChain }: WalletConnectRequestHandlerProps) {
  const [queue, setQueue] = useState<WalletKitTypes.SessionRequest[]>([]);
  const [processing, setProcessing] = useState(false);
  const current = queue[0] || null;

  useEffect(() => {
    let kitRef: Awaited<ReturnType<typeof getWalletKit>> | null = null;
    let cancelled = false;

    (async () => {
      try {
        const kit = await getWalletKit();
        if (cancelled) return;
        kitRef = kit;
        const onRequest = (event: WalletKitTypes.SessionRequest) => {
          setQueue((q) => [...q, event]);
        };
        kit.on('session_request', onRequest);
        return () => kit.off('session_request', onRequest);
      } catch {
        // WalletKit not configured (no Project ID) — silently no-op,
        // WalletConnectHandler already surfaces the config error on connect attempt
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const dismiss = useCallback(() => setQueue((q) => q.slice(1)), []);

  const handleReject = async () => {
    if (!current) return;
    await rejectRequest(current.topic, current.id).catch(() => {});
    dismiss();
  };

  const handleApprove = async () => {
    if (!current || !mnemonic) return;
    setProcessing(true);
    try {
      const { method, params } = current.params.request;
      const chainName = CHAIN_ID_TO_NAME[current.params.chainId] || 'Ethereum';
      const rpcUrl = getRpcUrlForChain(chainName);
      if (!rpcUrl) throw new Error(`No live RPC connected for ${chainName}`);

      const signer = getEvmSigner(mnemonic, rpcUrl);
      let result: string;

      if (method === 'personal_sign') {
        const [messageHex] = params;
        const message = messageHex.startsWith('0x')
          ? Buffer.from(messageHex.slice(2), 'hex').toString('utf8')
          : messageHex;
        result = await signer.signMessage(message);
      } else if (method === 'eth_sign') {
        const [, messageHex] = params;
        result = await signer.signMessage(Buffer.from(messageHex.slice(2), 'hex'));
      } else if (method === 'eth_signTypedData' || method === 'eth_signTypedData_v4') {
        const [, typedDataStr] = params;
        const typedData = JSON.parse(typedDataStr);
        const { domain, types, message } = typedData;
        const cleanTypes = { ...types };
        delete cleanTypes.EIP712Domain;
        result = await signer.signTypedData(domain, cleanTypes, message);
      } else if (method === 'eth_sendTransaction') {
        const [tx] = params;
        const sent = await signer.sendTransaction({
          to: tx.to, value: tx.value || '0x0', data: tx.data || '0x',
          gasLimit: tx.gas, gasPrice: tx.gasPrice, maxFeePerGas: tx.maxFeePerGas, maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
        });
        result = sent.hash;
      } else {
        throw new Error(`Unsupported method: ${method}`);
      }

      await respondToRequest(current.topic, current.id, result);
      toast({ title: 'Approved', description: `Signed request for ${current.verifyContext?.verified?.origin || 'the dApp'}.` });
      dismiss();
    } catch (err: any) {
      console.error('[WalletConnect] Request handling failed:', err);
      await rejectRequest(current.topic, current.id, err?.message || 'Signing failed').catch(() => {});
      toast({ variant: 'destructive', title: 'Request Failed', description: err?.shortMessage || err?.message || 'Unknown error' });
      dismiss();
    } finally {
      setProcessing(false);
    }
  };

  if (!current) return null;

  const { method, params } = current.params.request;
  const isTransaction = method === 'eth_sendTransaction';
  const tx = isTransaction ? params[0] : null;
  const origin = current.verifyContext?.verified?.origin || 'Unknown dApp';
  const chainName = CHAIN_ID_TO_NAME[current.params.chainId] || current.params.chainId;

  return (
    <Dialog open={true} onOpenChange={(v) => !v && !processing && handleReject()}>
      <DialogContent className="bg-[#0B0E1A] border border-white/10 rounded-[1.75rem] max-w-[380px] p-0 overflow-hidden [&>button]:hidden">
        <DialogHeader className="sr-only">
          <DialogTitle>WalletConnect Request</DialogTitle>
          <DialogDescription>A connected dApp is requesting a signature or transaction.</DialogDescription>
        </DialogHeader>

        <button
          onClick={() => !processing && handleReject()}
          className="absolute right-4 top-4 w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/60 transition-colors z-10"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="p-6 pt-8 space-y-6">
          <div className="text-center space-y-2">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-primary/10 flex items-center justify-center">
              {isTransaction ? <Send className="w-5 h-5 text-primary" /> : <FileSignature className="w-5 h-5 text-primary" />}
            </div>
            <h2 className="text-white text-xl font-bold">
              {isTransaction ? 'Approve Transaction' : 'Signature Request'}
            </h2>
            <p className="text-white/50 text-sm leading-relaxed px-2">
              <span className="text-white/80 font-medium">{origin}</span> wants your permission to {isTransaction ? 'send a transaction' : 'sign a message'}.
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-white/40 text-sm">Network</span>
              <span className="text-white font-semibold text-sm">{chainName}</span>
            </div>
            {isTransaction && tx && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-white/40 text-sm">To</span>
                  <span className="text-white font-mono text-sm">{tx.to?.slice(0, 6)}...{tx.to?.slice(-4)}</span>
                </div>
                {tx.value && tx.value !== '0x0' && (
                  <div className="flex items-center justify-between">
                    <span className="text-white/40 text-sm">Value</span>
                    <span className="text-white font-semibold text-sm">{formatEther(BigInt(tx.value))} {chainName === 'Base' ? 'ETH' : chainName === 'BSC' ? 'BNB' : 'ETH'}</span>
                  </div>
                )}
              </>
            )}
          </div>

          {!isTransaction && (
            <div className="border border-white/10 rounded-2xl p-4 max-h-32 overflow-y-auto">
              <p className="text-white/60 text-xs font-mono break-all">
                {method === 'personal_sign' ? Buffer.from(params[0].slice(2), 'hex').toString('utf8') : 'Structured data (EIP-712)'}
              </p>
            </div>
          )}

          <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-[10px] text-amber-200/80 leading-relaxed">
              Only approve if you trust this dApp and understand what you're signing. This cannot be undone.
            </p>
          </div>

          <div className="flex gap-3">
            <Button variant="outline" className="flex-1 h-12 rounded-2xl font-bold border-white/10 text-white" disabled={processing} onClick={handleReject}>
              Reject
            </Button>
            <Button className="flex-1 h-12 rounded-2xl bg-primary font-bold" disabled={processing} onClick={handleApprove}>
              {processing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}
              {processing ? 'Signing...' : 'Approve'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
