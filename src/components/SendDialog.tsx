"use client"

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Send, Loader2, ScanLine, CheckCircle2, AlertTriangle, ChevronLeft, Copy, Check, ShieldCheck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useTelegram } from '@/hooks/use-telegram';
import { sendEast } from '@/actions/mining-actions';
import { type Token } from '@/lib/token-service';
import { useWallet, decryptVaultMnemonic } from '@/lib/wallet-context';
import { useRPC } from '@/lib/rpc-context';
import { sendEvmTransaction, sendSolanaTransaction, estimateEvmFee, estimateSolanaFee, type FeeEstimate } from '@/lib/send-service';
import { signEvmMessage } from '@/lib/wallet-service';
import { buildSendEastPayload } from '@/lib/tx-payload-builders';
import { isAddress } from 'ethers';
import { PublicKey } from '@solana/web3.js';
import { QrCameraScanner } from '@/components/QrCameraScanner';

interface SendDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  startWithScanner?: boolean;
  selectedToken?: Token | null;
}

type Step = 'form' | 'review' | 'result';

function isValidSolanaAddress(address: string): boolean {
  try { new PublicKey(address); return true; } catch { return false; }
}

function truncate(addr: string, head = 6, tail = 4): string {
  if (!addr || addr.length <= head + tail + 3) return addr;
  return `${addr.slice(0, head)}...${addr.slice(-tail)}`;
}

/** Small inline "copy this text" button — used for both the review step's
 *  address row and the result step's tx hash. */
function CopyButton({ text, className = '' }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleCopy}
      className={`h-7 px-2 gap-1 rounded-lg border-white/30 text-white text-[10px] font-bold uppercase hover:bg-white/10 ${className}`}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}

export function SendDialog({ open, onOpenChange, startWithScanner = false, selectedToken }: SendDialogProps) {
  const { toast } = useToast();
  const { userId, initData, refreshUser } = useTelegram();
  const { mnemonic } = useWallet();
  const { currentRPC } = useRPC();
  const [step, setStep] = useState<Step>('form');
  const [address, setAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [sending, setSending] = useState(false);
  const [scanMode, setScanMode] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [feeEstimate, setFeeEstimate] = useState<FeeEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [gasFeeEast, setGasFeeEast] = useState('0');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setStep('form');
      setScanMode(startWithScanner);
      setTxHash(null);
      setAddress('');
      setAmount('');
      setFeeEstimate(null);
      setGasFeeEast('0');
      setConfirmPassword('');
      setPasswordError(null);
    }
  }, [open, startWithScanner]);

  const tokenLabel = selectedToken ? selectedToken.symbol : 'EAST';
  const networkLabel = selectedToken ? selectedToken.chain : 'EASTCHAIN';
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

  // Form step's button just validates + moves to the review/approve screen —
  // no network call happens here yet.
  const handleContinueToReview = () => {
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
    setStep('review');
  };

  // Review step's "Approve" button — this is where the actual send happens.
  // A correct password is required for every transaction, every time —
  // it's re-verified against the local encrypted vault right here rather
  // than trusting whatever unlock state is already cached in memory.
  const handleApprove = async () => {
    if (!confirmPassword) {
      setPasswordError('Enter your password to confirm this transaction.');
      return;
    }
    setSending(true);
    setPasswordError(null);

    let verifiedMnemonic: string;
    try {
      verifiedMnemonic = await decryptVaultMnemonic(confirmPassword);
    } catch {
      setPasswordError('Incorrect password.');
      setSending(false);
      return;
    }

    const amt = parseFloat(amount);
    try {
      if (isEastToken) {
        if (!userId) {
          toast({ variant: 'destructive', title: 'Not authenticated', description: 'Telegram session not found.' });
          return;
        }

        // Self-custody signature is now mandatory (password verified above),
        // not just an optional add-on to Telegram initData.
        let signature: string | undefined;
        try {
          const payload = buildSendEastPayload(userId, address.trim(), amt);
          signature = await signEvmMessage(verifiedMnemonic, payload);
        } catch (err) {
          console.error('[SendDialog] Self-custody signing failed:', err);
          toast({ variant: 'destructive', title: 'Signing failed', description: 'Could not sign this transaction. Please try again.' });
          return;
        }

        const result = await sendEast(userId, address.trim(), amt, initData, signature, undefined, parseFloat(gasFeeEast) || 0);
        if (result.success) {
          setTxHash(result.txHash || null);
          setStep('result');
          toast({ title: 'Transfer Queued', description: `${amt} EAST to ${truncate(address)} — confirming...` });
          refreshUser();
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
          setStep('form');
        }
        return;
      }

      // ── Real multi-chain send (non-EAST) ──────────────────────────
      if (!currentRPC?.url) {
        toast({ variant: 'destructive', title: 'No RPC connected', description: 'Wait for a live RPC endpoint to connect, then try again.' });
        setStep('form');
        return;
      }

      const result = isSolanaChain
        ? await sendSolanaTransaction({
            mnemonic: verifiedMnemonic, rpcUrl: currentRPC.url, toAddress: address.trim(), amount,
            mintAddress: selectedToken?.contractAddress, decimals: selectedToken?.decimals,
          })
        : await sendEvmTransaction({
            mnemonic: verifiedMnemonic, rpcUrl: currentRPC.url, toAddress: address.trim(), amount,
            contractAddress: selectedToken?.contractAddress, decimals: selectedToken?.decimals,
          });

      if (result.success) {
        setTxHash(result.txHash);
        setStep('result');
        toast({ title: 'Transaction Confirmed', description: `${amt} ${tokenLabel} sent — 1 confirmation.` });
      } else {
        toast({ variant: 'destructive', title: 'Transfer Failed', description: result.error });
        setStep('form');
      }
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Transfer Failed', description: e?.message || 'Unknown error' });
      setStep('form');
    } finally {
      setSending(false);
      setConfirmPassword('');
    }
  };

  const feeDisplay = isEastToken
    ? (parseFloat(gasFeeEast) > 0 ? `${gasFeeEast} EAST (priority)` : 'Free (standard)')
    : feeEstimate?.success
      ? `~${parseFloat(feeEstimate.fee).toFixed(6)} ${feeEstimate.feeSymbol}`
      : '—';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" className="flex-1 h-11 rounded-xl bg-white border-white text-black font-bold text-[10px] uppercase hover:bg-white/80 hover:text-black">
          <Send className="w-4 h-4 mr-2" /> Send
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-background border-white/20 rounded-[2rem] max-w-[380px]">

        {step === 'form' && (
          <>
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
                    className="h-6 text-[9px] gap-1 text-white font-bold uppercase"
                    onClick={() => setScanMode(v => !v)}
                  >
                    <ScanLine className="w-3 h-3" />
                    {scanMode ? 'Type' : 'Scan QR'}
                  </Button>
                </div>
                {scanMode ? (
                  <div className="space-y-2">
                    <QrCameraScanner
                      onScan={(result) => {
                        // Accept raw addresses or EIP-681-style "ethereum:0x..." / "solana:..." URIs
                        const cleaned = result.replace(/^(ethereum|solana|bitcoin):/i, '').split('?')[0];
                        setAddress(cleaned);
                        setScanMode(false);
                      }}
                      onError={(msg) => toast({ variant: 'destructive', title: 'Camera Error', description: msg })}
                    />
                    <Button variant="ghost" size="sm" className="w-full text-[9px] text-white" onClick={() => setScanMode(false)}>Enter manually instead</Button>
                  </div>
                ) : (
                  <Input
                    placeholder={isSolanaChain ? 'Solana address...' : '0x...'}
                    value={address}
                    onChange={e => setAddress(e.target.value)}
                    className="bg-secondary/30 border-white/10 font-mono text-sm rounded-xl h-12"
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
                  className="bg-secondary/30 border-white/10 font-mono text-sm rounded-xl h-12"
                />
                {availableBalance && (
                  <div className="flex items-center justify-between px-1">
                    <p className="text-[10px] text-muted-foreground">Available: {availableBalance}</p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 text-[9px] text-white font-bold uppercase px-1"
                      onClick={() => setAmount(selectedToken?.balance || '')}
                    >
                      Max
                    </Button>
                  </div>
                )}
              </div>

              {isEastToken && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-[10px] uppercase font-black text-muted-foreground">Priority Fee</Label>
                    <span className="text-[9px] text-muted-foreground">Higher fee = confirmed sooner</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: 'Standard', value: '0' },
                      { label: 'Priority', value: '1' },
                      { label: 'Express', value: '5' },
                    ].map(tier => (
                      <Button
                        key={tier.label}
                        type="button"
                        variant="outline"
                        onClick={() => setGasFeeEast(tier.value)}
                        className={`h-11 rounded-xl text-[10px] font-bold uppercase flex-col gap-0.5 ${
                          gasFeeEast === tier.value
                            ? 'bg-white/20 border-white text-white'
                            : 'bg-secondary/30 border-white/10 text-muted-foreground'
                        }`}
                      >
                        <span>{tier.label}</span>
                        <span className="font-mono text-[9px] opacity-70">{tier.value} EAST</span>
                      </Button>
                    ))}
                  </div>
                  <Input
                    type="number"
                    min="0"
                    step="0.1"
                    placeholder="Custom fee (EAST)"
                    value={gasFeeEast}
                    onChange={e => setGasFeeEast(e.target.value)}
                    className="bg-secondary/30 border-white/10 font-mono text-xs rounded-xl h-9"
                  />
                </div>
              )}

              {!isEastToken && (estimating || feeEstimate) && (
                <div className={`rounded-xl border p-3 text-[10px] space-y-1 ${
                  feeEstimate?.success === false || (feeEstimate?.success && !feeEstimate.sufficientForFee)
                    ? 'bg-red-500/10 border-red-500/20 text-red-400'
                    : 'bg-secondary/30 border-white/10 text-muted-foreground'
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

            <Button
              onClick={handleContinueToReview}
              disabled={
                !address || !amount || scanMode ||
                (!isEastToken && (estimating || (feeEstimate?.success && !feeEstimate.sufficientForFee)))
              }
              className="w-full h-12 rounded-2xl bg-white text-black font-black uppercase tracking-widest"
            >
              Review Transfer
            </Button>
          </>
        )}

        {step === 'review' && (
          <div className="-m-6 p-6 bg-[#0a0a12] rounded-[2rem] space-y-5">
            <div className="flex items-start justify-between">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStep('form')}
                className="h-8 w-8 p-0 rounded-full text-white/50 hover:text-white hover:bg-white/10 -ml-2"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
            </div>

            <div className="text-center space-y-2 px-2">
              <h2 className="text-white text-xl font-bold">Approve Transaction</h2>
              <p className="text-white/50 text-sm leading-relaxed">
                EASTCHAIN wants your permission to send the following transaction.
              </p>
            </div>

            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <span className="text-white/40 text-sm">To</span>
                <div className="flex items-center gap-2">
                  <span className="text-white font-mono text-sm">{truncate(address)}</span>
                  <CopyButton text={address} />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-white/40 text-sm">Network</span>
                <span className="text-white font-bold text-sm">{networkLabel}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-white/40 text-sm">Estimated fee</span>
                <span className="text-white font-bold text-sm">{feeDisplay}</span>
              </div>
            </div>

            <div className="rounded-xl border border-white/10 px-4 py-3 flex items-center justify-between">
              <span className="text-white font-mono text-sm">{amount} {tokenLabel}</span>
              <span className="text-white/40 text-xs">
                {isEastToken && parseFloat(gasFeeEast) > 0
                  ? `Total: ${(parseFloat(amount) + parseFloat(gasFeeEast)).toFixed(4)} EAST`
                  : 'Amount'}
              </span>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase font-black text-muted-foreground">Password Required</Label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => { setConfirmPassword(e.target.value); setPasswordError(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter' && confirmPassword && !sending) handleApprove(); }}
                placeholder="Enter your password to confirm"
                className="h-12 rounded-xl bg-white/5 border-white/10 text-white"
                autoFocus
              />
              {passwordError && <p className="text-destructive text-xs">{passwordError}</p>}
            </div>

            <Button
              onClick={handleApprove}
              disabled={sending || !confirmPassword}
              className="w-full h-12 rounded-2xl bg-white font-black uppercase tracking-widest text-black"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {sending ? 'Broadcasting...' : 'Approve'}
            </Button>

            <div className="flex items-center justify-center gap-1.5 text-white/30 text-[11px] pt-1">
              <ShieldCheck className="w-3.5 h-3.5" />
              Password required for every transaction · Secured by EASTCHAIN
            </div>
          </div>
        )}

        {step === 'result' && txHash && (
          <div className="py-6 space-y-4">
            <div className="flex flex-col items-center gap-2 text-center">
              <CheckCircle2 className="w-10 h-10 text-accent" />
              <p className="text-white font-bold">Transaction Sent</p>
              <p className="text-muted-foreground text-xs">{amount} {tokenLabel} to {truncate(address)}</p>
            </div>
            <div className="p-3 rounded-xl bg-accent/10 border border-accent/20 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[9px] uppercase font-bold text-accent/70">Transaction Hash</span>
                <CopyButton text={txHash} />
              </div>
              <p className="font-mono text-[10px] text-accent break-all">{txHash}</p>
            </div>
            <Button
              onClick={() => onOpenChange(false)}
              className="w-full h-12 rounded-2xl bg-white text-black font-black uppercase tracking-widest"
            >
              Done
            </Button>
          </div>
        )}

      </DialogContent>
    </Dialog>
  );
}
