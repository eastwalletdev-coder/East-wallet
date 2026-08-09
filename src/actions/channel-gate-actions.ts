'use server';

import { validateTelegramData, extractVerifiedUserId } from '@/lib/telegram';
import {
  checkTelegramChannelMembership,
  getChannelInviteLink,
  getRequiredChannel,
} from '@/lib/telegram-channel';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * Must pass before using the Mini App. Client shows join gate until ok.
 * Identity (initData) is validated when present; membership is always checked.
 */
export async function verifyRequiredChannel(telegramId: string, initData?: string) {
  if (!telegramId || !/^\d+$/.test(String(telegramId))) {
    return { success: false as const, joined: false, error: 'INVALID_TELEGRAM_ID' };
  }

  if (IS_PRODUCTION && initData) {
    if (!validateTelegramData(initData)) {
      return { success: false as const, joined: false, error: 'IDENTITY_VIOLATION' };
    }
    const verified = extractVerifiedUserId(initData);
    if (!verified || verified !== String(telegramId)) {
      return { success: false as const, joined: false, error: 'IDENTITY_MISMATCH' };
    }
  }
  // If initData not yet available (common first paint in WebView), still check
  // channel membership by telegram id — bot must be channel admin.

  const result = await checkTelegramChannelMembership(String(telegramId));
  return {
    success: true as const,
    joined: result.ok,
    status: result.status,
    channel: getRequiredChannel(),
    inviteLink: getChannelInviteLink(),
    error: result.error,
  };
}
