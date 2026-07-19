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

// ─── Validator heartbeat freshness (fast path) ────────────────────
// Moves the "is this validator still alive" check off Postgres — with
// many validators each heartbeating every 30s (see scripts/heartbeat-daemon.js),
// that's a steady stream of writes/reads hitting identity.validators just
// to answer a question Redis's native key expiry already answers for free.
// Postgres's last_heartbeat_at column is NOT removed — heartbeat/route.ts
// still updates it every time, so it remains the durable fallback (and
// what the admin panel displays) if Redis is ever unavailable.
const VALIDATOR_HEARTBEAT_TTL_SEC = 90; // MUST match HEARTBEAT_FRESHNESS_SECONDS in db/identity.ts

export async function recordHeartbeatRedis(telegramId: string): Promise<void> {
  const r = getRedis();
  if (!r) return; // fail open — the Postgres write in the same request still lands regardless
  try {
    await r.set(`validator-heartbeat:${telegramId}`, Date.now(), { ex: VALIDATOR_HEARTBEAT_TTL_SEC });
  } catch {
    // best-effort only — never block/fail the heartbeat request over a cache write
  }
}

/**
 * Batch-checks which of the given telegramIds have a fresh heartbeat in
 * Redis. Returns null (NOT an empty Set) if Redis is unavailable or errors,
 * so callers can tell "checked, nobody's fresh" apart from "couldn't check
 * at all" — the latter must fall back to Postgres's last_heartbeat_at,
 * never silently treat every validator as offline.
 */
export async function getFreshHeartbeatIdsRedis(telegramIds: string[]): Promise<Set<string> | null> {
  if (telegramIds.length === 0) return new Set();
  const r = getRedis();
  if (!r) return null;
  try {
    const keys = telegramIds.map((id) => `validator-heartbeat:${id}`);
    const values = await r.mget(...keys);
    const fresh = new Set<string>();
    telegramIds.forEach((id, i) => { if (values[i] != null) fresh.add(id); });
    return fresh;
  } catch {
    return null;
  }
}

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

// ─── User balance cache (TTL 30s) ────────────────────────────────
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

// ─── Archive endpoint rate limit ──────────────────────────────────
// Used by /api/archive/blocks/[height] (see route.ts). This endpoint used
// to be served straight from Cloudflare R2 — free egress, no rate limit
// needed. Now that R2 isn't used and the archive is served directly from
// Vercel/Postgres instead, every request is a real invocation + DB query,
// so it's worth capping per-caller volume. Generous enough for a Light
// Node's own concurrent catch-up batch (see ARCHIVE_CONCURRENCY in
// lightnode/client.ts), tight enough to blunt casual scraping.
const ARCHIVE_RATE_LIMIT_PER_WINDOW = 120;
const ARCHIVE_RATE_WINDOW_SEC = 60;

export async function checkArchiveRateLimit(identifier: string): Promise<{
  allowed: boolean;
  remainingSeconds?: number;
}> {
  const r = getRedis();
  if (!r) return { allowed: true }; // fallback: allow if Redis unavailable, same as every other cooldown above

  const key = `archive_rl:${identifier}`;
  try {
    const count = await r.incr(key);
    if (count === 1) {
      await r.expire(key, ARCHIVE_RATE_WINDOW_SEC);
    }
    if (count > ARCHIVE_RATE_LIMIT_PER_WINDOW) {
      const ttl = await r.ttl(key);
      return { allowed: false, remainingSeconds: ttl > 0 ? ttl : ARCHIVE_RATE_WINDOW_SEC };
    }
    return { allowed: true };
  } catch {
    return { allowed: true }; // fail open — an archive hiccup shouldn't block a Light Node's sync
  }
}
