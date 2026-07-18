"use client"

import { useState, useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ShieldCheck, Loader2, ShieldAlert, KeyRound, CheckCheck } from 'lucide-react';
import { exportWalletSecrets } from '@/actions/wallet-export-actions';
import {
  registerSelfCustody,
  getSelfCustodyState,
  applyAsValidatorCandidate,
} from '@/actions/self-custody-actions';
import {
  generateNewMnemonic,
  isValidMnemonic,
  publicKeyFromMnemonic,
  signWithMnemonic,
  saveMnemonicToVault,
  loadMnemonicFromVault,
  hasLocalVault,
} from '@/lib/east-self-custody';
import { buildSelfCustodyClaimMessage, buildValidatorClaimMessage } from '@/lib/east-claim-messages';
import { toast } from '@/hooks/use-toast';

interface SelfCustodyMigrationSheetProps {
  telegramId: string;
  initData: string;
  children?: React.ReactNode;
}

type Stage =
  | 'checking'
  | 'already_migrated'
  | 'choose_source'  // import old mnemonic vs generate new
  | 'import_mnemonic'
  | 'set_password'
  | 'signing'
  | 'done'
  | 'validator_apply';

export function SelfCustodyMigrationSheet({ telegramId, initData, children }: SelfCustodyMigrationSheetProps) {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>('checking');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mnemonic, setMnemonic] = useState('');
  const [pastedMnemonic, setPastedMnemonic] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [existingPubkey, setExistingPubkey] = useState<string | null>(null);
  const [validatorSubmitted, setValidatorSubmitted] = useState(false);

  const checkStatus = async () => {
    setLoading(true);
    const state = await getSelfCustodyState(telegramId, initData);
    setLoading(false);
    if (state.success && state.selfCustodyPubkey) {
      setExistingPubkey(state.selfCustodyPubkey);
      setStage('already_migrated');
    } else {
      setStage('choose_source');
    }
  };

  const handleOpenChange = (v: boolean) => {
    setOpen(v);
    if (v) {
      checkStatus();
    } else {
      // Drop everything sensitive from memory as soon as the sheet closes
      setStage('checking');
      setMnemonic('');
      setPastedMnemonic('');
      setPassword('');
      setPasswordConfirm('');
      setError(null);
      setValidatorSubmitted(false);
    }
  };

  const handleExportOld = async () => {
    setLoading(true);
    setError(null);
    const result = await exportWalletSecrets(telegramId, initData);
    setLoading(false);
    if (result.success) {
      setMnemonic(result.wallet.mnemonic);
      setStage('set_password');
    } else if (result.error === 'RATE_LIMITED') {
      setError(`Too many attempts. Try again in ${Math.ceil((result.remainingSeconds || 0) / 60)} min.`);
    } else {
      setError('Failed to fetch your old wallet. Try again.');
    }
  };

  const handleGenerateNew = () => {
    setMnemonic(generateNewMnemonic());
    setStage('set_password');
  };

  const handleUseImported = () => {
    setError(null);
    if (!isValidMnemonic(pastedMnemonic)) {
      setError('Invalid seed phrase. Check the 24 words again.');
      return;
    }
    setMnemonic(pastedMnemonic.trim());
    setStage('set_password');
  };

  const handleConfirmAndRegister = async () => {
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== passwordConfirm) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);
    setStage('signing');
    try {
      // 1. Save encrypted vault locally — device-only, never sent anywhere.
      await saveMnemonicToVault(mnemonic, password);

      // 2. Derive public key + sign the claim message locally.
      const { publicKeyHex } = publicKeyFromMnemonic(mnemonic);
      const claimMessage = buildSelfCustodyClaimMessage(telegramId, publicKeyHex);
      const signature = signWithMnemonic(mnemonic, claimMessage);

      // 3. Register with the server — only pubkey + signature leave the device.
      const result = await registerSelfCustody(telegramId, publicKeyHex, signature, initData);
      setLoading(false);

      if (result.success) {
        setExistingPubkey(publicKeyHex);
        setStage('done');
        // Wipe the mnemonic from React state now that it's safely vaulted.
        setMnemonic('');
        toast({ title: 'Self-custody active', description: 'Your key is now stored locally on this device.' });
      } else {
        setError(`Registration failed: ${result.error}`);
        setStage('set_password');
      }
    } catch (err) {
      setLoading(false);
      setError('Something went wrong while encrypting/signing. Try again.');
      setStage('set_password');
    }
  };

  const handleApplyValidator = async () => {
    setError(null);
    setLoading(true);
    try {
      const unlockPassword = window.prompt('Enter your local vault password to sign the validator application:');
      if (!unlockPassword) {
        setLoading(false);
        return;
      }
      const localMnemonic = await loadMnemonicFromVault(unlockPassword);
      const { publicKeyHex } = publicKeyFromMnemonic(localMnemonic);
      const claimMessage = buildValidatorClaimMessage(telegramId, publicKeyHex);
      const signature = signWithMnemonic(localMnemonic, claimMessage);

      const result = await applyAsValidatorCandidate(telegramId, publicKeyHex, signature, initData);
      setLoading(false);
      if (result.success) {
        setValidatorSubmitted(true);
        toast({ title: 'Application submitted', description: 'Awaiting admin review (status: pending_review).' });
      } else {
        setError(`Application failed: ${result.error}`);
      }
    } catch {
      setLoading(false);
      setError('Incorrect password or no local vault found on this device.');
    }
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        {children || (
          <Button variant="outline" className="h-12 rounded-2xl border-white/5 bg-white/5 hover:bg-white/10 text-white/60 text-[10px] font-black uppercase gap-2">
            <ShieldCheck className="w-4 h-4" /> Secure Wallet (Self-Custody)
          </Button>
        )}
      </SheetTrigger>
      <SheetContent side="bottom" className="h-[85vh] bg-background border-t border-primary/20 rounded-t-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-headline uppercase flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-primary" />
            Self-Custody Wallet
          </SheetTitle>
          <SheetDescription className="text-[10px]">
            Private key stored on this device, never sent to the server
          </SheetDescription>
        </SheetHeader>

        <div className="p-1 mt-4 space-y-4">
          {stage === 'checking' && (
            <div className="flex justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-white/40" />
            </div>
          )}

          {stage === 'already_migrated' && (
            <div className="space-y-4">
              <div className="p-4 bg-emerald-500/5 border border-emerald-500/20 rounded-2xl flex items-start gap-2">
                <CheckCheck className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider">Already Self-Custody</p>
                  <p className="text-[10px] text-white/60 mt-1 break-all font-mono">{existingPubkey}</p>
                </div>
              </div>
              <p className="text-[10px] text-white/40 leading-relaxed px-1">
                Your key is already registered as self-custody. To apply as a validator candidate,
                you'll need to unlock the local vault on this device (vault password, not your Telegram password).
              </p>
              <Button
                className="w-full h-12 rounded-xl bg-primary text-white font-bold text-xs uppercase gap-2"
                onClick={() => setStage('validator_apply')}
              >
                <KeyRound className="w-4 h-4" /> Apply to Become a Validator
              </Button>
            </div>
          )}

          {stage === 'choose_source' && (
            <div className="space-y-4">
              <div className="p-4 bg-amber-500/5 border border-amber-500/20 rounded-2xl space-y-2">
                <div className="flex items-center gap-2 text-amber-400">
                  <ShieldAlert className="w-4 h-4" />
                  <p className="text-[11px] font-bold uppercase tracking-wider">This is a one-way step</p>
                </div>
                <p className="text-[11px] text-white/60 leading-relaxed">
                  After this, your key is stored on this device only. If you lose the device and don't have
                  a backup seed phrase, your balance cannot be recovered through an admin.
                </p>
              </div>

              <div className="space-y-2">
                <Button
                  className="w-full h-12 rounded-xl bg-primary text-white font-bold text-xs uppercase gap-2"
                  disabled={loading}
                  onClick={handleExportOld}
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                  Use Old Wallet (Export)
                </Button>
                <p className="text-[9px] text-white/30 text-center px-2">
                  Recommended — your existing address and balance stay exactly the same
                </p>
              </div>

              <div className="space-y-2">
                <Button
                  variant="outline"
                  className="w-full h-12 rounded-xl border-white/10 text-white/60 font-bold text-xs uppercase"
                  onClick={handleGenerateNew}
                >
                  Generate New Wallet
                </Button>
                <Button
                  variant="ghost"
                  className="w-full h-10 rounded-xl text-white/40 font-bold text-[10px] uppercase"
                  onClick={() => setStage('import_mnemonic')}
                >
                  Or Import a Different Seed Phrase
                </Button>
              </div>
              {error && <p className="text-[10px] text-red-400 text-center">{error}</p>}
            </div>
          )}

          {stage === 'import_mnemonic' && (
            <div className="space-y-4">
              <p className="text-[11px] text-white/60 px-1">Paste your 24-word seed phrase, separated by spaces:</p>
              <Textarea
                value={pastedMnemonic}
                onChange={(e) => setPastedMnemonic(e.target.value)}
                placeholder="word1 word2 word3 ..."
                className="min-h-24 bg-secondary/30 rounded-xl font-mono text-[11px]"
              />
              {error && <p className="text-[10px] text-red-400 text-center">{error}</p>}
              <div className="flex gap-2">
                <Button variant="ghost" className="flex-1 h-11 rounded-xl text-[10px] uppercase" onClick={() => setStage('choose_source')}>
                  Back
                </Button>
                <Button className="flex-1 h-11 rounded-xl bg-primary text-white text-[10px] uppercase font-bold" onClick={handleUseImported}>
                  Continue
                </Button>
              </div>
            </div>
          )}

          {stage === 'set_password' && (
            <div className="space-y-4">
              <p className="text-[11px] text-white/60 px-1">
                Set a password to encrypt this key in your device's local storage. This password
                isn't stored anywhere — if you forget it, the key can't be unlocked again (but the seed phrase
                can still be used to re-import it, if you saved it).
              </p>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password (min. 8 characters)"
                className="h-12 bg-secondary/30 rounded-xl"
              />
              <Input
                type="password"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                placeholder="Repeat password"
                className="h-12 bg-secondary/30 rounded-xl"
              />
              {error && <p className="text-[10px] text-red-400 text-center">{error}</p>}
              <div className="flex gap-2">
                <Button variant="ghost" className="flex-1 h-11 rounded-xl text-[10px] uppercase" onClick={() => setStage('choose_source')}>
                  Back
                </Button>
                <Button
                  className="flex-1 h-11 rounded-xl bg-primary text-white text-[10px] uppercase font-bold gap-2"
                  disabled={loading}
                  onClick={handleConfirmAndRegister}
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                  Encrypt & Register
                </Button>
              </div>
            </div>
          )}

          {stage === 'signing' && (
            <div className="flex flex-col items-center gap-3 py-10">
              <Loader2 className="w-6 h-6 animate-spin text-white/40" />
              <p className="text-[10px] text-white/40 uppercase tracking-widest">Signing & registering...</p>
            </div>
          )}

          {stage === 'done' && (
            <div className="space-y-4">
              <div className="p-4 bg-emerald-500/5 border border-emerald-500/20 rounded-2xl flex items-start gap-2">
                <CheckCheck className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider">Success</p>
                  <p className="text-[10px] text-white/60 mt-1">
                    Your key is now self-custody, stored locally on this device.
                  </p>
                </div>
              </div>
              <Button className="w-full h-12 rounded-xl bg-primary text-white font-bold text-xs uppercase" onClick={() => handleOpenChange(false)}>
                Done
              </Button>
            </div>
          )}

          {stage === 'validator_apply' && (
            <div className="space-y-4">
              {validatorSubmitted ? (
                <div className="p-4 bg-emerald-500/5 border border-emerald-500/20 rounded-2xl">
                  <p className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider">Submitted</p>
                  <p className="text-[10px] text-white/60 mt-1">Status: pending_review — awaiting admin.</p>
                </div>
              ) : (
                <>
                  <p className="text-[11px] text-white/60 px-1 leading-relaxed">
                    This will ask for your local vault password to sign the validator candidate application.
                    The application goes in as <span className="font-mono text-white/80">pending_review</span> and
                    needs to be manually approved by an admin.
                  </p>
                  {error && <p className="text-[10px] text-red-400 text-center">{error}</p>}
                  <Button
                    className="w-full h-12 rounded-xl bg-primary text-white font-bold text-xs uppercase gap-2"
                    disabled={loading}
                    onClick={handleApplyValidator}
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                    Sign & Apply
                  </Button>
                </>
              )}
              <Button variant="ghost" className="w-full h-10 rounded-xl text-[10px] uppercase" onClick={() => handleOpenChange(false)}>
                Close
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
