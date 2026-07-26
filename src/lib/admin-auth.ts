import { NextRequest } from 'next/server';
import { verifyAdminSessionToken } from '@/lib/telegram-login-widget';
import crypto from 'crypto';
import { checkDestructiveLockout, recordDestructiveFailure, clearDestructiveLockout } from '@/lib/db/redis';

const FOUNDER_IDS = (process.env.FOUNDER_IDS || '').split(',').map((id) => id.trim()).filter(Boolean);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

export const ADMIN_SESSION_COOKIE = 'eastchain_admin_session';

export type AdminAuthResult =
  | { ok: true; telegramId?: string }
  | { ok: false; status: number; error: string };

/**
 * Shared auth gate for /api/admin/* routes. Accepts, in order:
 *
 *  1. A valid admin session cookie (set by /api/admin/telegram-login after
 *     verifying the Telegram Login Widget hash) — the path a human admin
 *     uses from the browser. Requires the telegram id to be in FOUNDER_IDS.
 *  2. x-cron-secret === ADMIN_SECRET — kept ONLY for machine callers that
 *     cannot produce a Telegram login (QStash scheduled jobs,
 *     apply-validator-cli.js / heartbeat-daemon.js scripts).
 *  3. Dev bypass when NODE_ENV !== 'production'.
 *
 * Never trust a client-supplied admin/telegram id for anything — the
 * returned `telegramId` (when present) comes from a verified session, so
 * callers can safely use it for audit fields like `reviewed_by`.
 */
export function requireFounderAuth(req: NextRequest): AdminAuthResult {
  const cookieToken = req.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  const session = verifyAdminSessionToken(cookieToken);
  if (session && FOUNDER_IDS.includes(session.telegramId)) {
    return { ok: true, telegramId: session.telegramId };
  }

  const secret = req.headers.get('x-cron-secret');
  if (secret && process.env.ADMIN_SECRET && secret === process.env.ADMIN_SECRET) {
    return { ok: true };
  }

  if (!IS_PRODUCTION) {
    return { ok: true };
  }

  return { ok: false, status: 401, error: 'UNAUTHORIZED' };
}

/**
 * Stricter variant for maximally destructive actions (currently just
 * genesis-reset) — NO x-cron-secret/ADMIN_SECRET fallback. These actions
 * should never be triggered by a machine/cron anyway, so accepting the
 * same shared secret that gates routine cron jobs would mean a single
 * ADMIN_SECRET leak = both "run migrations" AND "wipe the entire chain".
 * Requires a real Telegram-authenticated founder session every time.
 */
export function requireFounderSessionOnly(req: NextRequest): AdminAuthResult {
  const cookieToken = req.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  const session = verifyAdminSessionToken(cookieToken);
  if (session && FOUNDER_IDS.includes(session.telegramId)) {
    return { ok: true, telegramId: session.telegramId };
  }

  if (!IS_PRODUCTION) {
    return { ok: true }; // dev bypass still applies, for local testing
  }

  return { ok: false, status: 401, error: 'FOUNDER_SESSION_REQUIRED' };
}

/**
 * Second, INDEPENDENT factor required for genesis-reset and every
 * /api/admin/migrate-* route — on top of requireFounderSessionOnly /
 * requireFounderAuth, not instead of it.
 *
 * Why this exists: requireFounderSessionOnly is satisfied by nothing more
 * than a valid Telegram Login Widget session. If the founder's Telegram
 * account is ever compromised (SIM swap, session hijack, phishing), that
 * alone was previously enough to trigger genesis-reset — the "type
 * RESET_EVERYTHING_I_UNDERSTAND" confirm string doesn't help, because it's
 * a public constant rendered right there as the input's placeholder text;
 * anyone who loads the page can read it. It's a guard against fat-fingering
 * the button, not a secret.
 *
 * DESTRUCTIVE_ADMIN_PASSPHRASE fixes that: it's a value that exists ONLY
 * as a server-side env var, never sent to any client, never rendered
 * anywhere in the UI (no placeholder hint). A hijacked Telegram session is
 * no longer sufficient on its own — the attacker also needs this
 * passphrase, which should live somewhere Telegram-independent (a password
 * manager, not a note in Telegram Saved Messages).
 *
 * Fails CLOSED if the env var isn't set — an unconfigured secret must
 * never silently mean "no barrier". Rate-limited via Redis, also fail
 * closed (see checkDestructiveLockout's doc comment).
 */
export async function verifyDestructivePassphrase(
  candidate: unknown,
  rateLimitIdentifier: string
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const secret = process.env.DESTRUCTIVE_ADMIN_PASSPHRASE;
  if (!secret) {
    console.error('[EASTCHAIN] DESTRUCTIVE_ADMIN_PASSPHRASE is not set — refusing genesis-reset/migration until it is configured.');
    return { ok: false, status: 503, error: 'PASSPHRASE_NOT_CONFIGURED' };
  }

  const lockout = await checkDestructiveLockout(rateLimitIdentifier);
  if (lockout.locked) {
    return { ok: false, status: 429, error: `TOO_MANY_ATTEMPTS: locked for ${lockout.remainingSeconds}s` };
  }

  if (typeof candidate !== 'string' || candidate.length === 0) {
    return { ok: false, status: 400, error: 'PASSPHRASE_REQUIRED' };
  }

  // Constant-time comparison via fixed-length SHA-256 digests — avoids
  // both a length-based short-circuit and any timing side-channel on the
  // raw passphrase bytes.
  const a = crypto.createHash('sha256').update(candidate).digest();
  const b = crypto.createHash('sha256').update(secret).digest();
  const match = crypto.timingSafeEqual(a, b);

  if (!match) {
    await recordDestructiveFailure(rateLimitIdentifier);
    return { ok: false, status: 403, error: 'INVALID_PASSPHRASE' };
  }

  await clearDestructiveLockout(rateLimitIdentifier);
  return { ok: true };
}
