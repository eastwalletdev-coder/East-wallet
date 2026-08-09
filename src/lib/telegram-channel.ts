/**
 * Server-side Telegram channel membership check.
 * Bot must be admin of the required channel.
 */
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || '';
const REQUIRED_CHANNEL =
  process.env.NEXT_PUBLIC_REQUIRED_CHANNEL ||
  process.env.REQUIRED_CHANNEL ||
  '@Eastnetwork';

export function getRequiredChannel(): string {
  const c = REQUIRED_CHANNEL.trim();
  if (!c) return '@Eastnetwork';
  return c.startsWith('@') ? c : `@${c}`;
}

export function getChannelInviteLink(): string {
  const c = getRequiredChannel().replace(/^@/, '');
  return `https://t.me/${c}`;
}

export type ChannelMemberStatus =
  | 'member'
  | 'administrator'
  | 'creator'
  | 'left'
  | 'kicked'
  | 'restricted'
  | 'unknown'
  | 'error';

export async function checkTelegramChannelMembership(
  telegramUserId: string,
): Promise<{ ok: boolean; status: ChannelMemberStatus; error?: string }> {
  if (!BOT_TOKEN) {
    // Fail open in misconfigured deploys only if explicitly allowed
    if (process.env.CHANNEL_GATE_OPTIONAL === '1') {
      return { ok: true, status: 'unknown' };
    }
    return { ok: false, status: 'error', error: 'BOT_TOKEN_MISSING' };
  }

  const chatId = getRequiredChannel();
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/getChatMember?chat_id=${encodeURIComponent(chatId)}&user_id=${encodeURIComponent(telegramUserId)}`;

  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    const data = await res.json();
    if (!data?.ok) {
      const desc = String(data?.description || 'TELEGRAM_API_ERROR');
      // User never interacted / not found
      if (/user not found|chat not found/i.test(desc)) {
        return { ok: false, status: 'left', error: desc };
      }
      return { ok: false, status: 'error', error: desc };
    }
    const status = String(data.result?.status || 'unknown') as ChannelMemberStatus;
    const allowed = status === 'member' || status === 'administrator' || status === 'creator';
    // restricted with is_member true still counts
    if (status === 'restricted' && data.result?.is_member === true) {
      return { ok: true, status };
    }
    return { ok: allowed, status };
  } catch (e: any) {
    return { ok: false, status: 'error', error: e?.message || 'FETCH_FAILED' };
  }
}
