"use client"

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, ShieldCheck, Copy, CheckCheck, AlertTriangle, Wallet as WalletIcon } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useWallet, decryptVaultMnemonic } from '@/lib/wallet-context';
import { generateMnemonic, getEvmIdentity, signEvmMessage } from '@/lib/wallet-service';
import { createSelfCustodyWallet, upgradeToSelfCustodyWallet } from '@/actions/wallet-onboarding-actions';

/**
 * CreateWalletDialog
 * ─────────────────────────────────────────────────────────────────────
 * One wallet, one address, everywhere. This dialog no longer manages a
 * separate EAST-only vault — it drives the SAME 'east_vault' that backs
 * the multi-chain Wallet tab (via useWallet() / wallet-context.tsx), so
 * the EAST native address is always identical to the EVM address shown
 * in the Wallet tab.
 *
 * Three cases, detected automatically when the dialog opens:
 *  1. Vault already unlocked this session (wallet.mnemonic present) →
 *     nothing to ask, just confirm + sign + register.
 *  2. Vault exists but locked (hasPassword && isLocked) → ask for the
 *     EXISTING password to unlock it, then sign + register with that
 *     same address.
 *  3. No vault at all → generate a brand-new mnemonic, walk through
 *     backup + new password, persist it as 'east_vault', then sign +
 *     register. This is the ONLY case that creates a new wallet.
 */

type Step = 'intro' | 'backup' | 'setPassword' | 'unlockPassword' | 'submitting';

interface CreateWalletDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: 'new' | 'upgrade';
  telegramId: string;
  username: string;
  initData: string;
  startParam?: string;
  onSuccess: (user: any) => void;
}

function buildOwnershipPayload(telegramId: string, address: string): string {
  return `EASTCHAIN_WALLET_INIT_${telegramId}_${address.toLowerCase()}`;
}

export function CreateWalletDialog({
  open, onOpenChange, mode, telegramId, username, initData, startParam, onSuccess,
}: CreateWalletDialogProps) {
  const { toast } = useToast();
  const wallet = useWallet();

  const [step, setStep] = useState<Step>('intro');
  const [pendingMnemonic, setPendingMnemonic] = useState('');
  const [address, setAddress] = useState('');
  const [backedUp, setBackedUp] = useState(false);
  const [copied, setCopied] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');

  // Figure out which of the 3 cases we're in as soon as the dialog opens.
  useEffect(() => {
    if (!open) return;
    setError('');
    if (wallet.mnemonic) {
      const identity = getEvmIdentity(wallet.mnemonic);
      setAddress(identity.address);
      setStep('intro'); // already unlocked — intro screen just confirms + submits
    } else if (wallet.hasPassword) {
      setStep('intro'); // vault exists but locked — intro leads to unlockPassword
    } else {
      setStep('intro'); // no vault at all — intro leads to generate/backup
    }
  }, [open, wallet.mnemonic, wallet.hasPassword]);

  const reset = () => {
    setStep('intro'); setPendingMnemonic(''); setAddress(''); setBackedUp(false);
    setCopied(false); setPassword(''); setConfirmPassword(''); setError('');
  };

  const registerWithServer = async (mnemonicForSigning: string) => {
    const identity = getEvmIdentity(mnemonicForSigning);
    const payload = buildOwnershipPayload(telegramId, identity.address);
    const signature = await signEvmMessage(mnemonicForSigning, payload);

    return mode === 'new'
      ? createSelfCustodyWallet(telegramId, username, identity.address, identity.publicKey, signature, initData, startParam)
      : upgradeToSelfCustodyWallet(telegramId, identity.address, identity.publicKey, signature, initData);
  };

  // Case 1: vault already unlocked this session — just sign & register.
  const handleUseUnlockedWallet = async () => {
    if (!wallet.mnemonic) return;
    setStep('submitting');
    try {
      const result = await registerWithServer(wallet.mnemonic);
      if (!result.success) { setError(`Failed: ${result.error}`); setStep('intro'); return; }
      toast({ title: mode === 'new' ? 'EAST Wallet ready' : 'Upgrade successful', description: 'Same address as in the Wallet tab.' });
      onSuccess(result.user);
      onOpenChange(false);
      reset();
    } catch (err: any) {
      setError(err?.message || 'Something went wrong, try again');
      setStep('intro');
    }
  };

  // Case 2: vault exists but locked — unlock with existing password, then register.
  const handleUnlockExisting = async () => {
    if (!password) { setError('Enter your wallet password'); return; }
    setError('');
    setStep('submitting');
    try {
      const ok = await wallet.unlock(password); // syncs global context too (Wallet tab)
      if (!ok) { setError('Incorrect password'); setStep('unlockPassword'); return; }
      // Re-derive directly from the entered password rather than waiting on
      // context state, since setState from unlock() won't be visible yet
      // in this same closure.
      const phrase = await decryptVaultMnemonic(password);
      const result = await registerWithServer(phrase);
      if (!result.success) { setError(`Failed: ${result.error}`); setStep('unlockPassword'); return; }
      toast({ title: mode === 'new' ? 'EAST Wallet ready' : 'Upgrade successful', description: 'Same address as in the Wallet tab.' });
      onSuccess(result.user);
      onOpenChange(false);
      reset();
    } catch (err: any) {
      setError(err?.message || 'Incorrect password or an error occurred');
      setStep('unlockPassword');
    }
  };

  // Case 3, step A: generate a brand-new mnemonic to show for backup.
  const handleGenerate = () => {
    const m = generateMnemonic();
    const identity = getEvmIdentity(m);
    setPendingMnemonic(m);
    setAddress(identity.address);
    setStep('backup');
  };

  const handleCopyMnemonic = async () => {
    try { await navigator.clipboard.writeText(pendingMnemonic); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { /* clipboard unavailable — user can still select the text manually */ }
  };

  // Case 3, step B: set a NEW password, persist to 'east_vault', register.
  const handleCreateNew = async () => {
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    if (password !== confirmPassword) { setError('Password confirmation does not match'); return; }
    setError('');
    setStep('submitting');
    try {
      const result = await registerWithServer(pendingMnemonic);
      if (!result.success) { setError(`Failed to create wallet: ${result.error}`); setStep('setPassword'); return; }

      // Persist AFTER server confirms — same phrase shown during backup,
      // now becomes the one and only vault for EAST + multi-chain both.
      await wallet.createWallet(password, pendingMnemonic);

      toast({ title: 'Wallet created successfully', description: 'This one wallet is also used in the Wallet tab (multi-chain).' });
      onSuccess(result.user);
      onOpenChange(false);
      reset();
    } catch (err: any) {
      setError(err?.message || 'Something went wrong, try again');
      setStep('setPassword');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-md">
        {step === 'intro' && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {wallet.mnemonic ? <WalletIcon className="w-5 h-5 text-primary" /> : <ShieldCheck className="w-5 h-5 text-primary" />}
                {mode === 'new' ? 'Create Your EAST Wallet' : 'Upgrade to Self-Custody'}
              </DialogTitle>
              <DialogDescription>
                {wallet.mnemonic
                  ? 'Your multi-chain wallet is already active. The same address will be used for EAST native — no need to create a new wallet.'
                  : wallet.hasPassword
                    ? 'You already have a wallet (used in the Wallet tab). Enter its password to use the same address for EAST — no new recovery phrase needed.'
                    : mode === 'new'
                      ? 'Before you start mining, you need a real EVM-compatible wallet — the private key is generated & stored on your own device. This wallet also automatically becomes your wallet in the Wallet tab (multi-chain).'
                      : 'Your wallet currently uses a temporary address (not a real generated keypair). Upgrade to get a real EVM address you fully control — also used in the Wallet tab.'}
              </DialogDescription>
            </DialogHeader>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {wallet.mnemonic ? (
              <>
                <p className="text-[10px] text-muted-foreground break-all font-mono">{address}</p>
                <Button onClick={handleUseUnlockedWallet} className="w-full">Use This Wallet</Button>
              </>
            ) : wallet.hasPassword ? (
              <Button onClick={() => setStep('unlockPassword')} className="w-full">Enter Password</Button>
            ) : (
              <Button onClick={handleGenerate} className="w-full">Generate Wallet</Button>
            )}
          </>
        )}

        {step === 'unlockPassword' && (
          <>
            <DialogHeader>
              <DialogTitle>Unlock Wallet</DialogTitle>
              <DialogDescription>Enter your existing wallet password (the one used in the Wallet tab).</DialogDescription>
            </DialogHeader>
            <div>
              <Label htmlFor="unlock-pw">Password</Label>
              <Input id="unlock-pw" type="password" value={password} onChange={e => setPassword(e.target.value)} />
              {error && <p className="text-sm text-destructive mt-1">{error}</p>}
            </div>
            <DialogFooter>
              <Button onClick={handleUnlockExisting} className="w-full">Unlock & Continue</Button>
            </DialogFooter>
          </>
        )}

        {step === 'backup' && (
          <>
            <DialogHeader>
              <DialogTitle>Save Recovery Phrase</DialogTitle>
              <DialogDescription>These 24 words are the only way to recover your wallet (EAST & multi-chain). Don't share them with anyone.</DialogDescription>
            </DialogHeader>
            <Alert variant="destructive" className="mb-2">
              <AlertTriangle className="w-4 h-4" />
              <AlertDescription>If lost, the wallet & balance cannot be recovered. Write it on paper, don't screenshot.</AlertDescription>
            </Alert>
            <div className="grid grid-cols-3 gap-2 p-3 rounded-md bg-muted font-mono text-xs">
              {pendingMnemonic.split(' ').map((w, i) => (
                <div key={i}><span className="text-muted-foreground">{i + 1}.</span> {w}</div>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground break-all mt-1">Address: {address}</p>
            <Button variant="outline" size="sm" onClick={handleCopyMnemonic} className="w-fit">
              {copied ? <CheckCheck className="w-4 h-4 mr-1" /> : <Copy className="w-4 h-4 mr-1" />}
              {copied ? 'Copied' : 'Copy phrase'}
            </Button>
            <div className="flex items-center gap-2 mt-2">
              <Checkbox id="backedUp" checked={backedUp} onCheckedChange={(v) => setBackedUp(v === true)} />
              <Label htmlFor="backedUp" className="text-sm">I have safely saved this recovery phrase</Label>
            </div>
            <DialogFooter>
              <Button disabled={!backedUp} onClick={() => setStep('setPassword')} className="w-full">Continue</Button>
            </DialogFooter>
          </>
        )}

        {step === 'setPassword' && (
          <>
            <DialogHeader>
              <DialogTitle>Secure with Password</DialogTitle>
              <DialogDescription>This password encrypts the wallet on your device (also used to unlock the Wallet tab). The server never receives the password or private key.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label htmlFor="pw">Password</Label>
                <Input id="pw" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" />
              </div>
              <div>
                <Label htmlFor="pw2">Confirm Password</Label>
                <Input id="pw2" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
            <DialogFooter>
              <Button onClick={handleCreateNew} className="w-full">
                {mode === 'new' ? 'Create Wallet & Start Mining' : 'Confirm Upgrade'}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'submitting' && (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Saving wallet...</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
