import { createHmac } from 'crypto';

export function validateTelegramData(initData: string): boolean {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) return false;

    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return false;

    params.delete('hash');
    const sorted = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');

    const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
    const computed = createHmac('sha256', secretKey).update(sorted).digest('hex');
    return computed === hash;
  } catch {
    return false;
  }
}

// ─── Extract the real, HMAC-verified Telegram user ID from initData ───────
// Returns null if initData is missing, invalid, or malformed.
// Use this to cross-check any client-supplied tgId against the signed identity,
// instead of trusting a tgId parameter sent separately by the client.
export function extractVerifiedUserId(initData: string): string | null {
  try {
    if (!validateTelegramData(initData)) return null;

    const params = new URLSearchParams(initData);
    const userJson = params.get('user');
    if (!userJson) return null;

    const user = JSON.parse(userJson);
    if (!user?.id) return null;

    return String(user.id);
  } catch {
    return null;
  }
}

