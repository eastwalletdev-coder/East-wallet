import { NextRequest } from 'next/server';
import { verifyAdminSessionToken } from '@/lib/telegram-login-widget';

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
