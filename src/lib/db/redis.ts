/**
 * EASTCHAIN — Upstash Redis Cache
 * Rate limiting, network status, validator cache
 */
import { Redis } from '@upstash/redis';

let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }
  if (!redis) {
    redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return redis;
}

const CLAIM_COOLDOWN_SEC = 24 * 60 * 60; // 24 hours
const EXPORT_COOLDOWN_SEC = 5 * 60; // 5 minutes — throttle private key export attempts

// Rate limit: 1 claim per 24 hours per user
export async function checkClaimCooldown(telegramId: string): Promise<{
  allowed: boolean;
  remainingSeconds?: number;
}> {
  const r = getRedis();
  if (!r) return { allowed: true }; // fallback: allow if Redis unavailable

  const key = `claim:${telegramId}`;
  const ttl = await r.ttl(key);
  if (ttl > 0) return { allowed: false, remainingSeconds: ttl };
  return { allowed: true };
}

export async function setClaimCooldown(telegramId: string): Promise<void> {
  const r = getRedis();
  if (!r) return;
  await r.set(`claim:${telegramId}`, '1', { ex: CLAIM_COOLDOWN_SEC });
}

// Rate limit: throttle wallet-export requests (private key / mnemonic reveal)
export async function checkExportCooldown(telegramId: string): Promise<{
  allowed: boolean;
  remainingSeconds?: number;
}> {
  const r = getRedis();
  if (!r) return { allowed: true };

  const key = `export:${telegramId}`;
  const ttl = await r.ttl(key);
  if (ttl > 0) return { allowed: false, remainingSeconds: ttl };
  return { allowed: true };
}

export async function setExportCooldown(telegramId: string): Promise<void> {
  const r = getRedis();
  if (!r) return;
  await r.set(`export:${telegramId}`, '1', { ex: EXPORT_COOLDOWN_SEC });
}

// Network status cache
export async function getNetworkStatus(): Promise<string> {
  const r = getRedis();
  if (!r) return 'active';
  const status = await r.get<string>('network:status');
  return status || 'active';
}

export async function setNetworkStatus(status: 'active' | 'recovering' | 'halted'): Promise<void> {
  const r = getRedis();
  if (!r) return;
  await r.set('network:status', status);
}

// Top validators cache (refreshed every 24h epoch)
export async function getCachedValidators(): Promise<any[] | null> {
  const r = getRedis();
  if (!r) return null;
  return await r.get<any[]>('validators:top10');
}

export async function setCachedValidators(validators: any[]): Promise<void> {
  const r = getRedis();
  if (!r) return;
  await r.set('validators:top10', validators, { ex: 24 * 60 * 60 });
}

// ─── Archive endpoint rate limit ──────────────────────────────────
// Protects /api/archive/blocks/[heightJson] (Postgres-backed R2 fallback,
// see that route's comments) from being hammered — each request opens a
// real Postgres connection, unlike a CDN-cached R2 object. Fixed-window
// counter via INCR+EXPIRE; shared across all Vercel instances since it's
// Redis, not per-instance memory. Fails OPEN (allowed:true) if Redis isn't
// configured — same philosophy as every other function in this file, and
// consistent with this endpoint being read-only public block data anyway
// (worst case without Redis: no rate limit, not a data leak).
const ARCHIVE_RATE_LIMIT_WINDOW_SEC = 10;
const ARCHIVE_RATE_LIMIT_MAX = 30; // ~3/sec sustained — plenty for a Light Node catching up dozens of blocks, too slow to be worth DB-hammering with

export async function checkArchiveRateLimit(ip: string): Promise<{ allowed: boolean; remainingSeconds?: number }> {
  const r = getRedis();
  if (!r) return { allowed: true };

  try {
    const key = `archive-rl:${ip}`;
    const count = await r.incr(key);
    if (count === 1) {
      await r.expire(key, ARCHIVE_RATE_LIMIT_WINDOW_SEC);
    }
    if (count > ARCHIVE_RATE_LIMIT_MAX) {
      const ttl = await r.ttl(key);
      return { allowed: false, remainingSeconds: ttl > 0 ? ttl : ARCHIVE_RATE_LIMIT_WINDOW_SEC };
    }
    return { allowed: true };
  } catch {
    return { allowed: true }; // Redis error — fail open, same as everywhere else in this file
  }
}
// Read path only — write always goes to Postgres first
const USER_CACHE_TTL = 30; // seconds

export async function getCachedUser(telegramId: string): Promise<any | null> {
  const r = getRedis();
  if (!r) return null;
  try {
    return await r.get<any>(`user:${telegramId}`);
  } catch {
    return null;
  }
}

export async function setCachedUser(telegramId: string, userData: any): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.set(`user:${telegramId}`, userData, { ex: USER_CACHE_TTL });
  } catch {}
}

export async function invalidateCachedUser(telegramId: string): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.del(`user:${telegramId}`);
  } catch {}
}
