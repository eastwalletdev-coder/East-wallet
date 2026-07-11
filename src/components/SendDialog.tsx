"use client"

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Send, Loader2, ScanLine, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useTelegram } from '@/hooks/use-telegram';
import { sendEast } from '@/actions/mining-actions';
import { type Token } from '@/lib/token-service';
import { useWallet } from '@/lib/wallet-context';
import { useRPC } from '@/lib/rpc-context';
import { sendEvmTransaction, sendSolanaTransaction, estimateEvmFee, estimateSolanaFee, type FeeEstimate } from '@/lib/send-service';
import { isAddress } from 'ethers';
import { PublicKey } from '@solana/web3.js';

interface SendDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  startWithScanner?: boolean;
  selectedToken?: Token | null;
}

function isValidSolanaAddress(address: string): boolean {
  try { new PublicKey(address); return true; } catch { return false; }
}

export function SendDialog({ open, onOpenChange, startWithScanner = false, selectedToken }: SendDialogProps) {
  const { toast } = useToast();
  const { userId, initData, refreshUser } = useTelegram();
  const { mnemonic, isLocked } = useWallet();
  const { currentRPC } = useRPC();
  const [address, setAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [sending, setSending] = useState(false);
  const [scanMode, setScanMode] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [feeEstimate, setFeeEstimate] = useState<FeeEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);

  useEffect(() => {
    if (open) {
      setScanMode(startWithScanner);
      setTxHash(null);
      setAddress('');
      setAmount('');
      setFeeEstimate(null);
    }
  }, [open, startWithScanner]);

  const tokenLabel = selectedToken ? selectedToken.symbol : 'EAST';
  const availableBalance = selectedToken ? `${selectedToken.balance} ${selectedToken.symbol}` : null;
  const isEastToken = !selectedToken || selectedToken.symbol === 'EAST';
  const isSolanaChain = selectedToken?.chain === 'Solana';

  const validateAddress = (addr: string): boolean => {
    if (isEastToken) return /^0x[0-9a-fA-F]{40}$/.test(addr); // EAST addresses are EVM-shaped
    return isSolanaChain ? isValidSolanaAddress(addr) : isAddress(addr);
  };

  // Debounced fee preview — only for real multi-chain sends (EAST's gas
  // is abstracted away server-side, no user-facing native-token fee).
  useEffect(() => {
    if (isEastToken || !mnemonic || !currentRPC?.url) { setFeeEstimate(null); return; }
    const addr = address.trim();
    if (!addr || !amount || !validateAddress(addr) || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      setFeeEstimate(null);
      return;
    }

    const timer = setTimeout(async () => {
      setEstimating(true);
      try {
        const result = isSolanaChain
          ? await estimateSolanaFee({ mnemonic, rpcUrl: currentRPC.url, toAddress: addr, mintAddress: selectedToken?.contractAddress })
          : await estimateEvmFee({ mnemonic, rpcUrl: currentRPC.url, toAddress: addr, amount, contractAddress: selectedToken?.contractAddress, decimals: selectedToken?.decimals });
        setFeeEstimate(result);
      } finally {
        setEstimating(false);
      }
    }, 600); // debounce — don't hit the RPC on every keystroke

    return () => clearTimeout(timer);
  }, [address, amount, mnemonic, currentRPC?.url, isEastToken, isSolanaChain, selectedToken]);

  const handleSend = async () => {
    const amt = parseFloat(amount);
    if (!address.trim() || isNaN(amt) || amt <= 0) {
      toast({ variant: 'destructive', title: 'Invalid input', description: 'Enter a valid address and amount.' });
      return;
    }
    if (!validateAddress(address.trim())) {
      toast({ variant: 'destructive', title: 'Invalid address', description: isSolanaChain ? 'Use a valid Solana address.' : 'Use a valid address format.' });
      return;
    }
    if (!isEastToken && feeEstimate?.success && !feeEstimate.sufficientForFee) {
      toast({
        variant: 'destructive',
        title: 'Insufficient balance for network fee',
        description: `You need ~${feeEstimate.fee} ${feeEstimate.feeSymbol} to cover gas, but only have ${feeEstimate.nativeBalance} ${feeEstimate.feeSymbol}.`,
      });
      return;
    }

    setSending(true);
    try {
      if (isEastToken) {
        if (!userId) {
          toast({ variant: 'destructive', title: 'Not authenticated', description: 'Telegram session not found.' });
          return;
        }
        const result = await sendEast(userId, address.trim(), amt, initData);
        if (result.success) {
          setTxHash(result.txHash || null);
          toast({ title: 'Transfer Queued', description: `${amt} EAST to ${address.slice(0, 8)}...${address.slice(-6)} — confirming...` });
          refreshUser();
          setTimeout(() => onOpenChange(false), 1800);
        } else {
          const errMap: Record<string, string> = {
            INSUFFICIENT_BALANCE: 'Insufficient balance.',
            RECIPIENT_NOT_FOUND: 'Recipient address not found on EASTCHAIN.',
            CANNOT_SEND_TO_SELF: 'You cannot send to your own address.',
            IDENTITY_VIOLATION: 'Invalid Telegram session.',
            IDENTITY_MISMATCH: 'Session does not match the sender account.',
            SENDER_NOT_FOUND: 'Sender account not found.',
          };
          toast({ variant: 'destructive', title: 'Transfer Failed', description: errMap[result.error || ''] || result.error || 'Unknown error' });
        }
        return;
      }

      // ── Real multi-chain send (non-EAST) ──────────────────────────
      if (isLocked || !mnemonic) {
        toast({ variant: 'destructive', title: 'Wallet locked', description: 'Unlock your multi-chain wallet first.' });
        return;
      }
      if (!currentRPC?.url) {
        toast({ variant: 'destructive', title: 'No RPC connected', description: 'Wait for a live RPC endpoint to connect, then try again.' });
        return;
      }

      const result = isSolanaChain
        ? await sendSolanaTransaction({
            mnemonic, rpcUrl: currentRPC.url, toAddress: address.trim(), amount,
            mintAddress: selectedToken?.contractAddress, decimals: selectedToken?.decimals,
          })
        : await sendEvmTransaction({
            mnemonic, rpcUrl: currentRPC.url, toAddress: address.trim(), amount,
            contractAddress: selectedToken?.contractAddress, decimals: selectedToken?.decimals,
          });

      if (result.success) {
        setTxHash(result.txHash);
        toast({ title: 'Transaction Confirmed', description: `${amt} ${tokenLabel} sent — 1 confirmation.` });
        setTimeout(() => onOpenChange(false), 1800);
      } else {
        toast({ variant: 'destructive', title: 'Transfer Failed', description: result.error });
      }
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Transfer Failed', description: e?.message || 'Unknown error' });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" className="flex-1 h-11 rounded-xl bg-primary border-primary text-white font-bold text-[10px] uppercase hover:bg-primary/80 hover:text-white">
          <Send className="w-4 h-4 mr-2" /> Send
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-background border-primary/20 rounded-[2rem] max-w-[380px]">
        <DialogHeader>
          <DialogTitle className="font-headline uppercase">
            Send {selectedToken ? selectedToken.symbol : ''}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-[10px] uppercase font-black text-muted-foreground">Recipient Address</Label>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[9px] gap-1 text-primary font-bold uppercase"
                onClick={() => setScanMode(v => !v)}
              >
                <ScanLine className="w-3 h-3" />
                {scanMode ? 'Type' : 'Scan QR'}
              </Button>
            </div>
            {scanMode ? (
              <div className="h-36 bg-secondary/30 rounded-xl border border-primary/10 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                <ScanLine className="w-8 h-8 text-primary/40" />
                <p className="text-[10px] uppercase font-bold">Camera scanning not available in browser</p>
                <Button variant="ghost" size="sm" className="text-[9px] text-primary" onClick={() => setScanMode(false)}>Enter manually</Button>
              </div>
            ) : (
              <Input
                placeholder={isSolanaChain ? 'Solana address...' : '0x...'}
                value={address}
                onChange={e => setAddress(e.target.value)}
                className="bg-secondary/30 border-primary/10 font-mono text-sm rounded-xl h-12"
              />
            )}
          </div>

          <div className="space-y-2">
            <Label className="text-[10px] uppercase font-black text-muted-foreground">Amount</Label>
            <Input
              type="number"
              placeholder="0.00"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              className="bg-secondary/30 border-primary/10 font-mono text-sm rounded-xl h-12"
            />
            {availableBalance && (
              <div className="flex items-center justify-between px-1">
                <p className="text-[10px] text-muted-foreground">Available: {availableBalance}</p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 text-[9px] text-primary font-bold uppercase px-1"
                  onClick={() => setAmount(selectedToken?.balance || '')}
                >
                  Max
                </Button>
              </div>
            )}
          </div>

          {!isEastToken && (estimating || feeEstimate) && (
            <div className={`rounded-xl border p-3 text-[10px] space-y-1 ${
              feeEstimate?.success === false || (feeEstimate?.success && !feeEstimate.sufficientForFee)
                ? 'bg-red-500/10 border-red-500/20 text-red-400'
                : 'bg-secondary/30 border-primary/10 text-muted-foreground'
            }`}>
              {estimating ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin" /> Estimating network fee...
                </div>
              ) : feeEstimate?.success ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="uppercase font-bold">Network Fee</span>
                    <span className="font-mono">~{parseFloat(feeEstimate.fee).toFixed(6)} {feeEstimate.feeSymbol}</span>
                  </div>
                  {!feeEstimate.sufficientForFee && (
                    <div className="flex items-center gap-1.5 pt-1">
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      <span>Insufficient {feeEstimate.feeSymbol} to cover gas (have {parseFloat(feeEstimate.nativeBalance).toFixed(6)})</span>
                    </div>
                  )}
                </>
              ) : feeEstimate && !feeEstimate.success ? (
                <div className="flex items-center gap-1.5">
                  <AlertTriangle className="w-3 h-3 shrink-0" /> Couldn't estimate fee: {feeEstimate.error}
                </div>
              ) : null}
            </div>
          )}
        </div>

        {txHash && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-green-500/10 border border-green-500/20">
            <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
            <p className="font-mono text-[9px] text-green-400 break-all">{txHash}</p>
          </div>
        )}
        <Button
          onClick={handleSend}
          disabled={
            sending || !address || !amount || scanMode || !!txHash ||
            (!isEastToken && (estimating || (feeEstimate?.success && !feeEstimate.sufficientForFee)))
          }
          className="w-full h-12 rounded-2xl bg-primary font-black uppercase tracking-widest"
        >
          {sending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
          {sending ? 'Broadcasting...' : 'Confirm Transfer'}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
