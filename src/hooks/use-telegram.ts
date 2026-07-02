'use client';

import { useEffect, useState, useCallback } from 'react';
import { registerOrUpdateUser } from '@/actions/mining-actions';

interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
}

interface EastUser {
  telegramId: string;
  walletAddress: string;
  eastId?: string;
  username: string;
  balance: number;
  stakedAmount: number;
  eastpassTier: number;
  isFounder: boolean;
  referredBy: string;
  totalReferralBonus: number;
}

export function useTelegram() {
  const [tgUser, setTgUser] = useState<TelegramUser | null>(null);
  const [user, setUser] = useState<EastUser | null>(null);
  const [initData, setInitData] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [balanceLoading, setBalanceLoading] = useState(true);
  const [referralLink, setReferralLink] = useState<string>('');

  const fetchUser = useCallback(async (
    telegramId: string, username: string, initDataStr: string, startParam?: string
  ) => {
    try {
      const result = await registerOrUpdateUser(telegramId, username, initDataStr, startParam);
      if (result.success && result.user) {
        setUser(result.user as EastUser);
        setReferralLink(result.referralLink || '');
      }
    } catch (err) {
      console.error('[EASTCHAIN] Failed to register user:', err);
    } finally {
      setBalanceLoading(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const webApp = (window as any).Telegram?.WebApp;
    if (webApp) {
      webApp.ready();
      const tg = webApp.initDataUnsafe?.user;
      const startParam = webApp.initDataUnsafe?.start_param;
      const initDataStr = webApp.initData || '';
      setInitData(initDataStr);

      if (tg) {
        setTgUser(tg);

        // ── Level 3: Optimistic UI ─────────────────────────────────
        // Show name/ID from Telegram instantly — no server needed
        // Balance/wallet will fill in once server responds
        setUser(prev => prev ?? {
          telegramId: String(tg.id),
          walletAddress: '',
          username: tg.username || tg.first_name || 'miner',
          balance: 0,
          stakedAmount: 0,
          eastpassTier: 0,
          isFounder: false,
          referredBy: '',
          totalReferralBonus: 0,
        });
        setLoading(false); // UI unblocked immediately

        const username = tg.username || tg.first_name || 'miner';
        fetchUser(String(tg.id), username, initDataStr, startParam);
      } else {
        setLoading(false);
        setBalanceLoading(false);
      }
    } else {
      setLoading(false);
      setBalanceLoading(false);
    }
  }, [fetchUser]);

  return {
    tgUser,
    user,
    userId: tgUser ? String(tgUser.id) : '',
    initData,
    loading,
    balanceLoading,
    referralLink,
    refreshUser: () => {
      if (tgUser) {
        const webApp = (window as any).Telegram?.WebApp;
        setBalanceLoading(true);
        fetchUser(
          String(tgUser.id),
          tgUser.username || tgUser.first_name,
          webApp?.initData || initData
        );
      }
    },
  };
}
