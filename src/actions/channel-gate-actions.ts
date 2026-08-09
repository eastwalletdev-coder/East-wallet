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
 */
export async function verifyRequiredChannel(telegramId: string, initData?: string) {
  if (IS_PRODUCTION) {
    if (!initData || !validateTelegramData(initData)) {
      return { success: false as const, joined: false, error: 'IDENTITY_VIOLATION' };
    }
    const verified = extractVerifiedUserId(initData);
    if (!verified || verified !== telegramId) {
      return { success: false as const, joined: false, error: 'IDENTITY_MISMATCH' };
    }
  }

  const result = await checkTelegramChannelMembership(telegramId);
  return {
    success: true as const,
    joined: result.ok,
    status: result.status,
    channel: getRequiredChannel(),
    inviteLink: getChannelInviteLink(),
    error: result.error,
  };
}
