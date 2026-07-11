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
      if (!result.success) { setError(`Gagal: ${result.error}`); setStep('intro'); return; }
      toast({ title: mode === 'new' ? 'Wallet EAST siap' : 'Upgrade berhasil', description: 'Alamat sama seperti di tab Wallet.' });
      onSuccess(result.user);
      onOpenChange(false);
      reset();
    } catch (err: any) {
      setError(err?.message || 'Terjadi kesalahan, coba lagi');
      setStep('intro');
    }
  };

  // Case 2: vault exists but locked — unlock with existing password, then register.
  const handleUnlockExisting = async () => {
    if (!password) { setError('Masukkan password wallet kamu'); return; }
    setError('');
    setStep('submitting');
    try {
      const ok = await wallet.unlock(password); // syncs global context too (Wallet tab)
      if (!ok) { setError('Password salah'); setStep('unlockPassword'); return; }
      // Re-derive directly from the entered password rather than waiting on
      // context state, since setState from unlock() won't be visible yet
      // in this same closure.
      const phrase = await decryptVaultMnemonic(password);
      const result = await registerWithServer(phrase);
      if (!result.success) { setError(`Gagal: ${result.error}`); setStep('unlockPassword'); return; }
      toast({ title: mode === 'new' ? 'Wallet EAST siap' : 'Upgrade berhasil', description: 'Alamat sama seperti di tab Wallet.' });
      onSuccess(result.user);
      onOpenChange(false);
      reset();
    } catch (err: any) {
      setError(err?.message || 'Password salah atau terjadi kesalahan');
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
    if (password.length < 8) { setError('Password minimal 8 karakter'); return; }
    if (password !== confirmPassword) { setError('Konfirmasi password tidak cocok'); return; }
    setError('');
    setStep('submitting');
    try {
      const result = await registerWithServer(pendingMnemonic);
      if (!result.success) { setError(`Gagal membuat wallet: ${result.error}`); setStep('setPassword'); return; }

      // Persist AFTER server confirms — same phrase shown during backup,
      // now becomes the one and only vault for EAST + multi-chain both.
      await wallet.createWallet(password, pendingMnemonic);

      toast({ title: 'Wallet berhasil dibuat', description: 'Satu wallet ini juga dipakai di tab Wallet (multi-chain).' });
      onSuccess(result.user);
      onOpenChange(false);
      reset();
    } catch (err: any) {
      setError(err?.message || 'Terjadi kesalahan, coba lagi');
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
                {mode === 'new' ? 'Buat Wallet EAST Kamu' : 'Upgrade ke Self-Custody'}
              </DialogTitle>
              <DialogDescription>
                {wallet.mnemonic
                  ? 'Wallet multi-chain kamu sudah aktif. Alamat yang sama akan dipakai untuk EAST native — tidak perlu bikin wallet baru.'
                  : wallet.hasPassword
                    ? 'Kamu sudah punya wallet (dipakai di tab Wallet). Masukkan password-nya untuk pakai alamat yang sama untuk EAST — tidak perlu recovery phrase baru.'
                    : mode === 'new'
                      ? 'Sebelum mulai mining, kamu perlu wallet EVM-compatible sungguhan — private key dibuat & disimpan di device kamu sendiri. Wallet ini juga otomatis jadi wallet kamu di tab Wallet (multi-chain).'
                      : 'Wallet kamu saat ini pakai alamat sementara (bukan hasil keypair asli). Upgrade untuk dapat alamat EVM asli yang kamu kontrol sepenuhnya — dipakai juga di tab Wallet.'}
              </DialogDescription>
            </DialogHeader>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {wallet.mnemonic ? (
              <>
                <p className="text-[10px] text-muted-foreground break-all font-mono">{address}</p>
                <Button onClick={handleUseUnlockedWallet} className="w-full">Gunakan Wallet Ini</Button>
              </>
            ) : wallet.hasPassword ? (
              <Button onClick={() => setStep('unlockPassword')} className="w-full">Masukkan Password</Button>
            ) : (
              <Button onClick={handleGenerate} className="w-full">Generate Wallet</Button>
            )}
          </>
        )}

        {step === 'unlockPassword' && (
          <>
            <DialogHeader>
              <DialogTitle>Unlock Wallet</DialogTitle>
              <DialogDescription>Masukkan password wallet kamu yang sudah ada (yang dipakai di tab Wallet).</DialogDescription>
            </DialogHeader>
            <div>
              <Label htmlFor="unlock-pw">Password</Label>
              <Input id="unlock-pw" type="password" value={password} onChange={e => setPassword(e.target.value)} />
              {error && <p className="text-sm text-destructive mt-1">{error}</p>}
            </div>
            <DialogFooter>
              <Button onClick={handleUnlockExisting} className="w-full">Unlock & Lanjut</Button>
            </DialogFooter>
          </>
        )}

        {step === 'backup' && (
          <>
            <DialogHeader>
              <DialogTitle>Simpan Recovery Phrase</DialogTitle>
              <DialogDescription>24 kata ini adalah satu-satunya cara memulihkan wallet kamu (EAST & multi-chain). Jangan share ke siapa pun.</DialogDescription>
            </DialogHeader>
            <Alert variant="destructive" className="mb-2">
              <AlertTriangle className="w-4 h-4" />
              <AlertDescription>Kalau hilang, wallet & saldo tidak bisa dipulihkan. Tulis di kertas, jangan screenshot.</AlertDescription>
            </Alert>
            <div className="grid grid-cols-3 gap-2 p-3 rounded-md bg-muted font-mono text-xs">
              {pendingMnemonic.split(' ').map((w, i) => (
                <div key={i}><span className="text-muted-foreground">{i + 1}.</span> {w}</div>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground break-all mt-1">Alamat: {address}</p>
            <Button variant="outline" size="sm" onClick={handleCopyMnemonic} className="w-fit">
              {copied ? <CheckCheck className="w-4 h-4 mr-1" /> : <Copy className="w-4 h-4 mr-1" />}
              {copied ? 'Disalin' : 'Salin phrase'}
            </Button>
            <div className="flex items-center gap-2 mt-2">
              <Checkbox id="backedUp" checked={backedUp} onCheckedChange={(v) => setBackedUp(v === true)} />
              <Label htmlFor="backedUp" className="text-sm">Saya sudah menyimpan recovery phrase ini dengan aman</Label>
            </div>
            <DialogFooter>
              <Button disabled={!backedUp} onClick={() => setStep('setPassword')} className="w-full">Lanjut</Button>
            </DialogFooter>
          </>
        )}

        {step === 'setPassword' && (
          <>
            <DialogHeader>
              <DialogTitle>Amankan dengan Password</DialogTitle>
              <DialogDescription>Password ini mengenkripsi wallet di device kamu (dipakai juga untuk buka tab Wallet). Server tidak pernah menerima password atau private key.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label htmlFor="pw">Password</Label>
                <Input id="pw" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Minimal 8 karakter" />
              </div>
              <div>
                <Label htmlFor="pw2">Konfirmasi Password</Label>
                <Input id="pw2" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
            <DialogFooter>
              <Button onClick={handleCreateNew} className="w-full">
                {mode === 'new' ? 'Buat Wallet & Mulai Mining' : 'Konfirmasi Upgrade'}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'submitting' && (
          <div className="flex flex-col items-center justify-center py-8 gap-3">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Menyimpan wallet...</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
