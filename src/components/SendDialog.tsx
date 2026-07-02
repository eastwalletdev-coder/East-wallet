"use client"

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Send, Loader2, ScanLine, CheckCircle2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useTelegram } from '@/hooks/use-telegram';
import { sendEast } from '@/actions/mining-actions';
import { type Token } from '@/lib/token-service';

interface SendDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  startWithScanner?: boolean;
  selectedToken?: Token | null;
}

export function SendDialog({ open, onOpenChange, startWithScanner = false, selectedToken }: SendDialogProps) {
  const { toast } = useToast();
  const { userId, initData, refreshUser } = useTelegram();
  const [address, setAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [sending, setSending] = useState(false);
  const [scanMode, setScanMode] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);

  // Reset state saat dialog dibuka
  useEffect(() => {
    if (open) {
      setScanMode(startWithScanner);
      setTxHash(null);
    }
  }, [open, startWithScanner]);

  const tokenLabel = selectedToken ? selectedToken.symbol : 'EAST';
  const availableBalance = selectedToken ? `${selectedToken.balance} ${selectedToken.symbol}` : null;
  const isEastToken = !selectedToken || selectedToken.symbol === 'EAST';

  const handleSend = async () => {
    if (!userId) {
      toast({ variant: 'destructive', title: 'Not authenticated', description: 'Telegram session not found.' });
      return;
    }
    const amt = parseFloat(amount);
    if (!address.trim() || isNaN(amt) || amt <= 0) {
      toast({ variant: 'destructive', title: 'Invalid input', description: 'Enter a valid address and amount.' });
      return;
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(address.trim())) {
      toast({ variant: 'destructive', title: 'Invalid address', description: 'Use the 0x EVM address format.' });
      return;
    }
    if (!isEastToken) {
      toast({ variant: 'destructive', title: 'Not supported', description: 'Only EAST transfers are supported at this time.' });
      return;
    }
    setSending(true);
    try {
      const result = await sendEast(userId, address.trim(), amt, initData);
      if (result.success) {
        setTxHash(result.txHash || null);
        toast({ title: 'Transfer Successful', description: `${amt} EAST sent to ${address.slice(0, 8)}...${address.slice(-6)}` });
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
          {/* Address input + scan toggle */}
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
                placeholder="0x..."
                value={address}
                onChange={e => setAddress(e.target.value)}
                className="bg-secondary/30 border-primary/10 font-mono text-sm rounded-xl h-12"
              />
            )}
          </div>

          {/* Amount */}
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
        </div>

        {txHash && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-green-500/10 border border-green-500/20">
            <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
            <p className="font-mono text-[9px] text-green-400 break-all">{txHash}</p>
          </div>
        )}
        <Button
          onClick={handleSend}
          disabled={sending || !address || !amount || scanMode || !!txHash}
          className="w-full h-12 rounded-2xl bg-primary font-black uppercase tracking-widest"
        >
          {sending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
          {sending ? 'Broadcasting...' : 'Confirm Transfer'}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
