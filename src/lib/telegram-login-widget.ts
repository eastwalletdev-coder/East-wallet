import { createHmac, createHash } from 'crypto';

/**
 * EASTCHAIN — Telegram Login Widget verification (for the browser-based
 * admin page). NOT the same scheme as Mini App initData in telegram.ts.
 *
 * Telegram's Login Widget (https://core.telegram.org/widgets/login) uses a
 * different HMAC secret derivation than WebApp.initData:
 *   - WebApp initData:  secret = HMAC_SHA256("WebAppData", bot_token)
 *   - Login Widget:     secret = SHA256(bot_token)
 * Both then compute HMAC_SHA256(secret, data_check_string) over the sorted
 * key=value pairs (excluding "hash").
 */

const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60; // reject stale login payloads (replay window)

export function verifyTelegramLoginWidget(payload: Record<string, string>): boolean {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) return false;

    const { hash, ...rest } = payload;
    if (!hash) return false;

    const dataCheckString = Object.keys(rest)
      .sort()
      .map((k) => `${k}=${rest[k]}`)
      .join('\n');

    const secretKey = createHash('sha256').update(botToken).digest();
    const computed = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    if (computed !== hash) return false;

    const authDate = Number(rest.auth_date);
    if (!authDate || Date.now() / 1000 - authDate > MAX_AUTH_AGE_SECONDS) return false;

    return true;
  } catch {
    return false;
  }
}

// ─── Admin session token (signed, cookie-based) ────────────────────────────
// Self-contained signed token so subsequent admin requests don't need to
// re-verify the Telegram Login Widget hash. Format:
//   <telegramId>.<expiresAtMs>.<hmacHex>
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function sessionSecret(): string {
  // Falls back to ADMIN_SECRET so this works even before ADMIN_SESSION_SECRET
  // is configured, but a dedicated secret is recommended — otherwise rotating
  // ADMIN_SECRET (e.g. after a leak) invalidates cron/CLI auth and admin
  // sessions together.
  return process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_SECRET || '';
}

export function createAdminSessionToken(telegramId: string): string {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = `${telegramId}.${expiresAt}`;
  const sig = createHmac('sha256', sessionSecret()).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

export function verifyAdminSessionToken(token: string | undefined | null): { telegramId: string } | null {
  try {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [telegramId, expiresAtStr, sig] = parts;
    const expiresAt = Number(expiresAtStr);
    if (!telegramId || !expiresAt || !sig) return null;
    if (Date.now() > expiresAt) return null;

    const payload = `${telegramId}.${expiresAt}`;
    const expectedSig = createHmac('sha256', sessionSecret()).update(payload).digest('hex');
    if (!timingSafeEqualHex(expectedSig, sig)) return null;

    return { telegramId };
  } catch {
    return null;
  }
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
