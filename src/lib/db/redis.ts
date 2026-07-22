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

// ─── Chain state cache (TTL 8s) ───────────────────────────────────
// getChainState() in mining-actions.ts is global — same answer for
// every user at any given moment — but is currently polled every 30s
// from 4 different screens (Home, Explorer, MiningDashboard, Validator
// page) with ZERO caching: 4 separate Postgres queries per call, every
// time, for every concurrent user. A short TTL here means only the
// first caller in each ~8s window actually touches Postgres; everyone
// else in that window gets the cached copy. 8s (not longer) because
// blockCount should still feel current to someone actively watching it
// tick up.
const CHAIN_STATE_CACHE_TTL = 8; // seconds

export async function getCachedChainState(): Promise<any | null> {
  const r = getRedis();
  if (!r) return null;
  return await r.get<any>('chainstate:latest');
}

export async function setCachedChainState(state: any): Promise<void> {
  const r = getRedis();
  if (!r) return;
  await r.set('chainstate:latest', state, { ex: CHAIN_STATE_CACHE_TTL });
}

// Same reasoning as chain state above — polled every 30s from the
// Explorer page (see src/app/explorer/_ledger.tsx), identical for every
// concurrent viewer. Keyed by limit since callers can ask for different
// counts, though in practice this app only ever calls them with a couple
// of fixed values.
export async function getCachedRecentBlocks(limit: number): Promise<any[] | null> {
  const r = getRedis();
  if (!r) return null;
  return await r.get<any[]>(`explorer:blocks:${limit}`);
}

export async function setCachedRecentBlocks(limit: number, blocks: any[]): Promise<void> {
  const r = getRedis();
  if (!r) return;
  await r.set(`explorer:blocks:${limit}`, blocks, { ex: CHAIN_STATE_CACHE_TTL });
}

export async function getCachedRecentVotes(limit: number): Promise<any[] | null> {
  const r = getRedis();
  if (!r) return null;
  return await r.get<any[]>(`explorer:votes:${limit}`);
}

export async function setCachedRecentVotes(limit: number, votes: any[]): Promise<void> {
  const r = getRedis();
  if (!r) return;
  await r.set(`explorer:votes:${limit}`, votes, { ex: CHAIN_STATE_CACHE_TTL });
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

// ─── Producer daemon endpoint caching + rate limits ────────────────
// scripts/block-producer-daemon.js heartbeats every 30s AND polls
// /api/consensus/my-proposal every 2s, FOREVER, per running daemon. Before
// this, both hit Postgres on every single call — the 2s poll alone is
// ~43,000 Postgres round trips/day per daemon. On Neon's free tier, that
// means the compute node never gets to autosuspend (it only suspends
// after a few minutes of true inactivity), so it silently burns through
// the whole monthly compute-hour budget in days. Everything below either
// serves repeat calls straight from Redis (free, no Neon cost) or caps
// how often Postgres gets touched at all.

async function checkGenericRateLimit(key: string, limit: number, windowSec: number): Promise<{
  allowed: boolean;
  remainingSeconds?: number;
}> {
  const r = getRedis();
  if (!r) return { allowed: true };
  try {
    const count = await r.incr(key);
    if (count === 1) await r.expire(key, windowSec);
    if (count > limit) {
      const ttl = await r.ttl(key);
      return { allowed: false, remainingSeconds: ttl > 0 ? ttl : windowSec };
    }
    return { allowed: true };
  } catch {
    return { allowed: true };
  }
}

// Defense-in-depth against a runaway/duplicate daemon (e.g. accidentally
// started twice) — the daemon's own setInterval is the primary control,
// this just caps the damage if that's ever bypassed. Generous margin over
// the intended cadence so a healthy single daemon never trips it.
export async function checkHeartbeatRateLimit(telegramId: string) {
  return checkGenericRateLimit(`hb_rl:${telegramId}`, 4, 60); // ~1 per 30s intended → allow up to 4/min
}
export async function checkProposalPollRateLimit(telegramId: string) {
  return checkGenericRateLimit(`proposal_rl:${telegramId}`, 45, 60); // ~1 per 2s intended (30/min) → allow up to 45/min
}

// Caches the identity.users/identity.validators JOIN that /api/node/heartbeat
// needs to authorize a caller (self_custody_pubkey + is_active). This data
// changes rarely — pubkey essentially never after self-custody registration,
// is_active at most once per 24h epoch — so a 5-minute cache still stays
// accurate enough while skipping the Postgres round trip on nearly every
// 30s heartbeat call.
const VALIDATOR_AUTH_CACHE_TTL_SEC = 300;

export type ValidatorAuthCache = { pubkey: string; isActiveValidator: boolean };

export async function getCachedValidatorAuth(telegramId: string): Promise<ValidatorAuthCache | null> {
  const r = getRedis();
  if (!r) return null;
  try {
    return await r.get<ValidatorAuthCache>(`validator-auth:${telegramId}`);
  } catch {
    return null;
  }
}

export async function setCachedValidatorAuth(telegramId: string, auth: ValidatorAuthCache): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.set(`validator-auth:${telegramId}`, auth, { ex: VALIDATOR_AUTH_CACHE_TTL_SEC });
  } catch {}
}

// Throttles the actual Postgres UPDATE inside recordValidatorHeartbeat().
// Redis's own heartbeat key (recordHeartbeatRedis above) is already the
// fast-path freshness source getActiveExternalValidators() reads — Postgres's
// last_heartbeat_at only needs to stay roughly fresh as the DURABLE
// fallback for when Redis is down, not updated on every single 30s ping.
const PG_HEARTBEAT_WRITE_THROTTLE_SEC = 180; // write to Postgres at most once per 3 min per validator

export async function shouldWriteHeartbeatToPostgres(telegramId: string): Promise<boolean> {
  const r = getRedis();
  if (!r) return true; // Redis down — Postgres is now the only source of truth, always write
  const key = `hb_pg_throttle:${telegramId}`;
  try {
    // SET with NX only succeeds if the key didn't already exist — that's
    // our "am I still within the throttle window" check in one round trip.
    const result = await r.set(key, '1', { nx: true, ex: PG_HEARTBEAT_WRITE_THROTTLE_SEC });
    return result !== null;
  } catch {
    return true; // fail open toward writing — never worse than pre-throttle behavior
  }
}

// Write-through cache for a validator's currently-pending block proposal
// (see createProposal() in leader-schedule.ts, which writes here right
// after the Postgres INSERT). /api/consensus/my-proposal checks this FIRST
// on every poll — a hit costs nothing against Neon. Distinguishes "checked,
// nothing pending" ({pending:false} — trust it, skip Postgres) from "Redis
// itself is unreachable" (null — caller MUST fall back to Postgres), same
// convention as getFreshHeartbeatIdsRedis above. This is deliberately NOT
// used to negative-cache "nothing pending" from the READ side — only the
// WRITE side (the moment a proposal is actually created) populates it, so
// a genuinely new proposal is visible on the daemon's very next 2s poll
// instead of being hidden behind a stale negative cache.
export type CachedProposal = {
  proposalId: number;
  blockIndex: number;
  prevHash: string;
  txHashes: string[];
  isEmpty: boolean;
  deadlineAt: string; // ISO
};

export async function setCachedProposal(telegramId: string, proposal: CachedProposal, ttlSeconds: number): Promise<void> {
  const r = getRedis();
  if (!r) return; // best-effort — the Postgres row is still the source of truth
  try {
    await r.set(`proposal:${telegramId}`, proposal, { ex: Math.max(1, ttlSeconds) });
  } catch {}
}

export async function getCachedProposal(telegramId: string): Promise<CachedProposal | { pending: false } | null> {
  const r = getRedis();
  if (!r) return null; // unreachable — caller falls back to Postgres
  try {
    const cached = await r.get<CachedProposal>(`proposal:${telegramId}`);
    return cached ?? { pending: false };
  } catch {
    return null;
  }
}
