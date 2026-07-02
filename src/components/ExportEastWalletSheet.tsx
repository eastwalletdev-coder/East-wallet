"use client"

import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { KeyRound, Loader2, ShieldAlert, Copy, CheckCheck, Eye, EyeOff, Lock } from 'lucide-react';
import { exportWalletSecrets } from '@/actions/wallet-export-actions';
import { toast } from '@/hooks/use-toast';

interface ExportEastWalletSheetProps {
  telegramId: string;
  initData: string;
  children?: React.ReactNode; // custom trigger, optional
}

interface WalletExportData {
  mnemonic: string;
  derivationPath: string;
  privateKeyHex: string;
  privateKeyBase58: string;
  publicKeyHex: string;
  publicKeyBase58: string;
  evm: { derivationPath: string; address: string; privateKeyHex: string };
}

// Simple confirmation gate — typing this exact phrase proves the user
// read the warning. Not a password (there's nothing server-side to
// check it against), just friction against accidental taps.
const CONFIRM_PHRASE = 'REVEAL';

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const el = document.createElement('textarea');
      el.value = value;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="bg-white/[0.04] rounded-xl p-3 space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[9px] uppercase font-bold text-white/40 tracking-widest">{label}</span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCopy}>
          {copied ? <CheckCheck className="w-3.5 h-3.5 text-white" /> : <Copy className="w-3.5 h-3.5 text-white/40" />}
        </Button>
      </div>
      <p className="font-mono text-[10px] text-white/70 break-all">{value}</p>
    </div>
  );
}

export function ExportEastWalletSheet({ telegramId, initData, children }: ExportEastWalletSheetProps) {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<'warning' | 'confirm' | 'revealed'>('warning');
  const [confirmText, setConfirmText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wallet, setWallet] = useState<WalletExportData | null>(null);
  const [showMnemonic, setShowMnemonic] = useState(false);

  const reset = () => {
    setStage('warning');
    setConfirmText('');
    setError(null);
    setWallet(null); // drop the secret from memory as soon as the sheet closes
    setShowMnemonic(false);
  };

  const handleOpenChange = (v: boolean) => {
    setOpen(v);
    if (!v) reset();
  };

  const handleReveal = async () => {
    setLoading(true);
    setError(null);
    const result = await exportWalletSecrets(telegramId, initData);
    setLoading(false);
    if (result.success) {
      setWallet(result.wallet);
      setStage('revealed');
    } else if (result.error === 'RATE_LIMITED') {
      const secs = result.remainingSeconds || 0;
      setError(`Terlalu sering. Coba lagi dalam ${Math.ceil(secs / 60)} menit.`);
    } else {
      setError('Gagal mengambil kunci. Coba lagi.');
    }
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        {children || (
          <Button variant="outline" className="h-12 rounded-2xl border-white/5 bg-white/5 hover:bg-white/10 text-white/60 text-[10px] font-black uppercase gap-2">
            <KeyRound className="w-4 h-4" /> Export Private Key
          </Button>
        )}
      </SheetTrigger>
      <SheetContent side="bottom" className="h-[85vh] bg-background border-t border-primary/20 rounded-t-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-headline uppercase flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-primary" />
            Export EAST Wallet
          </SheetTitle>
          <SheetDescription className="text-[10px]">
            Seed phrase & private key untuk akun EAST kamu (Telegram ID: {telegramId})
          </SheetDescription>
        </SheetHeader>

        <div className="p-1 mt-4">
          {stage === 'warning' && (
            <div className="space-y-4">
              <div className="p-4 bg-red-500/5 border border-red-500/20 rounded-2xl space-y-2">
                <div className="flex items-center gap-2 text-red-400">
                  <ShieldAlert className="w-4 h-4" />
                  <p className="text-[11px] font-bold uppercase tracking-wider">Jangan bagikan ke siapa pun</p>
                </div>
                <p className="text-[11px] text-white/60 leading-relaxed">
                  Siapa pun yang punya seed phrase atau private key ini bisa mengambil alih seluruh saldo EAST kamu.
                  Tim EASTCHAIN — termasuk admin — tidak akan pernah memintanya.
                </p>
              </div>
              <div className="p-4 bg-white/[0.03] rounded-2xl border border-white/5 space-y-2">
                <p className="text-[11px] text-white/60 leading-relaxed">
                  Tulis / foto dan simpan di tempat aman offline. Kalau perangkat kamu hilang, ini satu-satunya cara memulihkan akun.
                </p>
              </div>
              <Button className="w-full h-12 rounded-xl bg-primary text-white font-bold text-xs uppercase" onClick={() => setStage('confirm')}>
                Saya Mengerti, Lanjutkan
              </Button>
            </div>
          )}

          {stage === 'confirm' && (
            <div className="space-y-4">
              <p className="text-[11px] text-white/60 text-center">
                Ketik <span className="font-mono font-bold text-white">{CONFIRM_PHRASE}</span> untuk konfirmasi
              </p>
              <Input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value.toUpperCase())}
                placeholder={CONFIRM_PHRASE}
                className="h-12 bg-secondary/30 rounded-xl text-center font-mono tracking-widest"
                autoFocus
              />
              {error && <p className="text-[10px] text-red-400 text-center">{error}</p>}
              <div className="flex gap-2">
                <Button variant="ghost" className="flex-1 h-11 rounded-xl text-[10px] uppercase" onClick={() => setStage('warning')}>
                  Kembali
                </Button>
                <Button
                  className="flex-1 h-11 rounded-xl bg-primary text-white text-[10px] uppercase font-bold gap-2"
                  disabled={confirmText !== CONFIRM_PHRASE || loading}
                  onClick={handleReveal}
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                  Reveal
                </Button>
              </div>
            </div>
          )}

          {stage === 'revealed' && wallet && (
            <div className="space-y-5">
              {/* Mnemonic */}
              <div className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <p className="text-[10px] font-black uppercase tracking-widest text-white/40">Seed Phrase (24 kata)</p>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowMnemonic(v => !v)}>
                    {showMnemonic ? <EyeOff className="w-4 h-4 text-white/40" /> : <Eye className="w-4 h-4 text-white/40" />}
                  </Button>
                </div>
                {showMnemonic ? (
                  <div className="grid grid-cols-3 gap-2">
                    {wallet.mnemonic.split(' ').map((word, i) => (
                      <div key={i} className="bg-white/5 p-2 rounded-xl text-center border border-white/10">
                        <span className="text-[8px] text-muted-foreground block mb-0.5">{i + 1}</span>
                        <span className="text-[11px] font-mono font-bold text-foreground">{word}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="h-20 bg-white/[0.03] rounded-2xl flex items-center justify-center border border-dashed border-white/10 cursor-pointer" onClick={() => setShowMnemonic(true)}>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Tap untuk tampilkan</p>
                  </div>
                )}
                {showMnemonic && (
                  <Button variant="outline" className="w-full h-10 rounded-xl border-primary/20 text-primary text-[10px] uppercase font-bold gap-2" onClick={async () => {
                    await navigator.clipboard.writeText(wallet.mnemonic);
                    toast({ title: 'Seed phrase disalin' });
                  }}>
                    <Copy className="w-3.5 h-3.5" /> Copy Seed Phrase
                  </Button>
                )}
              </div>

              {/* EAST / Solana-style key */}
              <div className="space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-white/40 px-1">
                  EAST Key ({wallet.derivationPath})
                </p>
                <CopyRow label="Public Key" value={wallet.publicKeyBase58} />
                <CopyRow label="Private Key" value={wallet.privateKeyBase58} />
              </div>

              {/* EVM bonus key */}
              <div className="space-y-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-white/40 px-1">
                  EVM Key — MetaMask Compatible ({wallet.evm.derivationPath})
                </p>
                <CopyRow label="Address" value={wallet.evm.address} />
                <CopyRow label="Private Key" value={wallet.evm.privateKeyHex} />
              </div>

              <Button variant="ghost" className="w-full h-10 text-[10px] uppercase text-white/40" onClick={() => handleOpenChange(false)}>
                Selesai & Tutup
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
