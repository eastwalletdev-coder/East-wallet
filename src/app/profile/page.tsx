"use client"

import { useState, useCallback, useEffect, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { User, Shield, Globe, Award, Settings, FileText, ChevronRight, Crown, Copy, CheckCheck, Users, KeyRound, Coins, ShieldCheck } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { useTelegram } from '@/hooks/use-telegram';
import { ExportEastWalletSheet } from '@/components/ExportEastWalletSheet';
import { CreateWalletDialog } from '@/components/CreateWalletDialog';
import { useWallet } from '@/lib/wallet-context';
import { getEvmIdentity, signEvmMessage } from '@/lib/wallet-service';
import { upgradeToSelfCustodyWallet } from '@/actions/wallet-onboarding-actions';
import { useToast } from '@/hooks/use-toast';

export default function ProfilePage() {
  const { userId, user, loading, initData, refreshUser } = useTelegram();
  const { mnemonic, isLocked } = useWallet();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [copiedRef, setCopiedRef] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const vaultAddress = useMemo(() => {
    if (!mnemonic || isLocked) return null;
    try { return getEvmIdentity(mnemonic).address; } catch { return null; }
  }, [mnemonic, isLocked]);

  const profileAddress = user?.walletAddress || '';
  const addressMismatch =
    Boolean(vaultAddress && profileAddress) &&
    vaultAddress!.toLowerCase() !== profileAddress.toLowerCase();

  // Prefer vault so Profile matches Wallet / Receive when unlocked
  const walletAddress = vaultAddress || profileAddress || '0x...';
  const isFounder = user?.isFounder === true;
  const isSelfCustody = user?.walletType === 'self_custody_evm' && !addressMismatch;
  const referralLink = `https://t.me/${process.env.NEXT_PUBLIC_BOT_USERNAME || 'Eastwallet_bot'}?start=${userId}`;

  useEffect(() => {
    if (!userId || !mnemonic || !vaultAddress || !addressMismatch || syncing) return;
    let cancelled = false;
    (async () => {
      setSyncing(true);
      try {
        const payload = `EASTCHAIN_WALLET_INIT_${userId}_${vaultAddress.toLowerCase()}`;
        const { publicKey } = getEvmIdentity(mnemonic);
        const signature = await signEvmMessage(mnemonic, payload);
        const result = await upgradeToSelfCustodyWallet(
          userId, vaultAddress, publicKey, signature, initData,
        );
        if (cancelled) return;
        if (result.success) {
          await refreshUser();
          toast({ title: 'Profile address synced', description: 'Profile now matches your self-custody wallet.' });
        }
      } catch { /* non-fatal */ }
      finally { if (!cancelled) setSyncing(false); }
    })();
    return () => { cancelled = true; };
  }, [userId, mnemonic, vaultAddress, addressMismatch, initData, refreshUser, toast, syncing]);

  const handleCopyAddress = useCallback(async () => {
    try { await navigator.clipboard.writeText(walletAddress); }
    catch {
      const el = document.createElement('textarea');
      el.value = walletAddress; document.body.appendChild(el);
      el.select(); document.execCommand('copy'); document.body.removeChild(el);
    }
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }, [walletAddress]);

  const handleCopyReferral = useCallback(async () => {
    try { await navigator.clipboard.writeText(referralLink); }
    catch {
      const el = document.createElement('textarea');
      el.value = referralLink; document.body.appendChild(el);
      el.select(); document.execCommand('copy'); document.body.removeChild(el);
    }
    setCopiedRef(true); setTimeout(() => setCopiedRef(false), 2000);
  }, [referralLink]);

  return (
    <div className="flex flex-col gap-4 px-3 py-4 pb-8">

      {/* Header */}
      <header className="flex justify-between items-center">
        <h1 className="text-white font-extrabold text-xl uppercase tracking-widest">Profile</h1>
        <Settings className="w-5 h-5 text-white/40" />
      </header>

      {/* Avatar */}
      <div className="flex flex-col items-center gap-3 py-2">
        <div className="relative">
          <Avatar className="w-20 h-20 border-2 border-primary/30">
            <AvatarFallback className="bg-primary/10 text-primary text-2xl font-bold">
              {user?.username?.[0]?.toUpperCase() || 'U'}
            </AvatarFallback>
          </Avatar>
          <div className="absolute -bottom-1 -right-1 bg-indigo-700 p-1.5 rounded-full border-2 border-background">
            <Award className="w-3 h-3 text-white" />
          </div>
        </div>
        <div className="text-center">
          <div className="flex items-center justify-center gap-2">
            <h2 className="text-white font-bold text-lg">
              {loading ? "Syncing..." : (user?.username ? `@${user.username}` : "@miner")}
            </h2>
            {isFounder && (
              <Badge className="bg-primary/20 text-primary border-primary/30 text-[10px] font-black">
                <Crown className="w-3 h-3 mr-1" />FOUNDER
              </Badge>
            )}
          </div>
          <p className="text-primary text-sm font-medium">
            {user?.eastpassTier || 0 > 0 ? "Elite Validator" : "Genesis Miner"}
          </p>
        </div>
      </div>

      {/* Founder card */}
      {isFounder && (
        <Card className="bg-primary/5 border-primary/20 rounded-2xl">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-primary text-[10px] uppercase font-black tracking-widest">Founder Allocation</p>
              <p className="text-white font-bold text-sm">50,000,000 EAST</p>
            </div>
            <p className="text-white/40 text-[10px] uppercase font-bold">Vested</p>
          </CardContent>
        </Card>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="bg-white/[0.03] border-white/5 rounded-2xl">
          <CardContent className="p-3 text-center">
            <p className="text-white/40 text-[10px] uppercase font-bold">Identity Score</p>
            <p className="text-white font-bold text-lg">{loading ? "..." : Math.floor((user?.balance || 0) / 10)}</p>
          </CardContent>
        </Card>
        <Card className="bg-white/[0.03] border-white/5 rounded-2xl">
          <CardContent className="p-3 text-center">
            <p className="text-white/40 text-[10px] uppercase font-bold">L2 Status</p>
            <p className="text-primary font-bold text-lg">ACTIVE</p>
          </CardContent>
        </Card>
      </div>

      {/* Referral */}
      <Card className="bg-white/[0.03] border-white/5 rounded-2xl">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              <p className="text-primary text-[10px] font-bold uppercase">Referral Program</p>
            </div>
            <p className="text-white/50 text-[10px] font-bold">{user?.totalReferralBonus || 0} / 5,000 EAST</p>
          </div>
          <div className="bg-white/[0.04] rounded-xl p-2 flex items-center justify-between gap-2">
            <p className="font-mono text-[10px] text-white/40 truncate flex-1">{referralLink}</p>
            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={handleCopyReferral}>
              {copiedRef ? <CheckCheck className="w-3 h-3 text-white" /> : <Copy className="w-3 h-3 text-white/40" />}
            </Button>
          </div>
          <p className="text-white/30 text-[10px]">1 EAST per active referral · Max 5,000 EAST lifetime</p>
        </CardContent>
      </Card>

      {/* Identity */}
      <div className="space-y-2">
        <p className="text-white/40 text-[10px] uppercase font-bold px-1">Network Identity</p>
        <div className="bg-white/[0.03] rounded-2xl border border-white/5 divide-y divide-white/5">
          <div className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Shield className="w-4 h-4 text-primary" />
              <span className="text-white text-sm">Telegram ID</span>
            </div>
            <span className="font-mono text-xs text-white/40">{userId || '—'}</span>
          </div>

          <div className="p-4 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Globe className="w-4 h-4 text-primary" />
                <span className="text-white text-sm">Wallet Address</span>
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCopyAddress}>
                {copied ? <CheckCheck className="w-4 h-4 text-white" /> : <Copy className="w-4 h-4 text-white/40" />}
              </Button>
            </div>
            <div className="bg-white/[0.04] rounded-xl p-2">
              <p className="font-mono text-[10px] text-white/40 break-all">{walletAddress}</p>
            </div>
            {addressMismatch && (
              <p className="text-[9px] text-amber-400/90 leading-relaxed">
                {syncing
                  ? 'Syncing Profile to vault address…'
                  : `Vault ${vaultAddress?.slice(0, 8)}… ≠ server ${profileAddress.slice(0, 8)}…. Unlock wallet or tap Upgrade to fix.`}
              </p>
            )}
            {vaultAddress && !addressMismatch && user?.walletType === 'self_custody_evm' && (
              <p className="text-[9px] text-white/25">Matches Wallet / Receive (self-custody)</p>
            )}
          </div>

          <div className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ShieldCheck className="w-4 h-4 text-primary" />
              <div>
                <span className="text-white text-sm block">Wallet Custody</span>
                <span className="text-white/30 text-[10px] uppercase">
                  {user?.walletType === 'self_custody_evm' && !addressMismatch
                    ? 'You control the private key'
                    : addressMismatch
                      ? 'Address mismatch — sync required'
                      : 'Server-derived (legacy)'}
                </span>
              </div>
            </div>
            {user?.walletType === 'self_custody_evm' && !addressMismatch ? (
              <Badge className="bg-primary/20 text-primary border-primary/30 text-[9px] font-black uppercase">
                Self-Custody
              </Badge>
            ) : (
              <Button
                size="sm"
                disabled={!userId || syncing}
                onClick={() => setUpgradeOpen(true)}
                className="h-8 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 text-[9px] font-black uppercase tracking-widest"
              >
                {addressMismatch ? 'Sync' : 'Upgrade'}
              </Button>
            )}
          </div>

          <div className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <User className="w-4 h-4 text-primary" />
              <span className="text-white text-sm">Consensus Role</span>
            </div>
            <span className="text-white/60 text-xs font-bold uppercase">
              {isFounder ? "Chain Architect" : (user?.stakedAmount || 0) >= 500 ? "Active Validator" : "Miner Node"}
            </span>
          </div>

          <Link href="/validator" className="p-4 flex items-center justify-between border-t border-white/[0.04] hover:bg-white/[0.02] transition-colors">
            <div className="flex items-center gap-3">
              <Shield className="w-4 h-4 text-primary" />
              <span className="text-white text-sm">Validator Panel</span>
            </div>
            <ChevronRight className="w-4 h-4 text-white/20" />
          </Link>
        </div>
      </div>

      {/* Export Wallet */}
      {userId && (
        <ExportEastWalletSheet telegramId={userId} initData={initData}>
          <Button variant="outline" className="w-full h-12 rounded-2xl border border-primary/30 bg-primary/10 hover:bg-primary/20 text-primary text-[10px] font-black uppercase gap-2">
            <KeyRound className="w-4 h-4" />
            Export Private Key & Seed Phrase
          </Button>
        </ExportEastWalletSheet>
      )}

      {/* Whitepaper link */}
      <Link href="/whitepaper">
        <div className="bg-white/[0.03] rounded-2xl border border-white/5 p-4 flex items-center justify-between hover:bg-primary/5 transition-colors">
          <div className="flex items-center gap-3">
            <FileText className="w-5 h-5 text-primary" />
            <div>
              <p className="text-white text-sm font-medium">Whitepaper</p>
              <p className="text-white/30 text-[10px] uppercase">Architecture & Protocol</p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-white/30" />
        </div>
      </Link>

      {/* Tokenomics link */}
      <Link href="/tokenomics">
        <div className="bg-white/[0.03] rounded-2xl border border-white/5 p-4 flex items-center justify-between hover:bg-primary/5 transition-colors">
          <div className="flex items-center gap-3">
            <Coins className="w-5 h-5 text-primary" />
            <div>
              <p className="text-white text-sm font-medium">Tokenomics</p>
              <p className="text-white/30 text-[10px] uppercase">Supply, Allocation & Vesting</p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-white/30" />
        </div>
      </Link>

      <p className="text-white/20 text-[10px] text-center leading-relaxed">
        Your identity is cryptographically mapped to the EASTCHAIN ledger.
      </p>

      {userId && (
        <CreateWalletDialog
          open={upgradeOpen}
          onOpenChange={setUpgradeOpen}
          mode="upgrade"
          telegramId={userId}
          username={user?.username || 'miner'}
          initData={initData}
          onSuccess={() => {
            setUpgradeOpen(false);
            refreshUser();
          }}
        />
      )}
    </div>
  );
}
