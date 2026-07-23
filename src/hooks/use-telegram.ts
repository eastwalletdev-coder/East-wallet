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
  walletType: string;
  eastId?: string;
  username: string;
  balance: number;
  stakedAmount: number;
  pendingUnstakeAmount: number;
  pendingUnstakeClaimableAt: number;
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
    // Retry only for IDENTITY_VIOLATION — this is the error registerOrUpdateUser
    // returns when initData is missing/not-yet-populated by the Telegram WebView,
    // which is a timing issue, not an auth failure. Any other error (e.g.
    // IDENTITY_MISMATCH) means the request itself is invalid, so it must NOT be
    // retried — retrying those would just repeat a legitimately-rejected request.
    const MAX_ATTEMPTS = 3;
    const RETRY_DELAY_MS = 900;

    try {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const result = await registerOrUpdateUser(telegramId, username, initDataStr, startParam);
        if (result.success && result.user) {
          setUser(result.user as EastUser);
          setReferralLink(result.referralLink || '');
          return;
        }

        const isTransient = result.error === 'IDENTITY_VIOLATION';
        const hasAttemptsLeft = attempt < MAX_ATTEMPTS;
        if (!isTransient || !hasAttemptsLeft) {
          console.error('[EASTCHAIN] Failed to register user:', result.error);
          return;
        }
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * attempt));
      }
    } catch (err) {
      console.error('[EASTCHAIN] Failed to register user:', err);
    } finally {
      setBalanceLoading(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let cancelled = false;

    const init = (webApp: any) => {
      if (cancelled) return;
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
          walletType: 'custodial_hash',
          username: tg.username || tg.first_name || 'miner',
          balance: 0,
          stakedAmount: 0,
          pendingUnstakeAmount: 0,
          pendingUnstakeClaimableAt: 0,
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
    };

    // The telegram-web-app.js <script> tag is loaded with `async`, so it can
    // still be mid-flight when this effect first runs — `window.Telegram`
    // would be undefined and we'd give up permanently (only fixed by a full
    // reload or remount). Poll briefly for it instead of checking once.
    const existing = (window as any).Telegram?.WebApp;
    if (existing) {
      init(existing);
      return;
    }

    const POLL_INTERVAL_MS = 100;
    const MAX_WAIT_MS = 4000;
    let waited = 0;
    const intervalId = setInterval(() => {
      const webApp = (window as any).Telegram?.WebApp;
      if (webApp) {
        clearInterval(intervalId);
        init(webApp);
        return;
      }
      waited += POLL_INTERVAL_MS;
      if (waited >= MAX_WAIT_MS) {
        clearInterval(intervalId);
        // Not running inside Telegram (or script truly failed to load) —
        // stop waiting and unblock the UI.
        if (!cancelled) {
          setLoading(false);
          setBalanceLoading(false);
        }
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
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
