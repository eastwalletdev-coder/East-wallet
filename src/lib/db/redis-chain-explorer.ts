/**
 * Redis cache keys for validator-backed explorer (separate from Neon ledger cache).
 */
import { Redis } from '@upstash/redis';

const TTL_SEC = Number(process.env.EXPLORER_CHAIN_CACHE_TTL || 10);

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

const STATE_KEY = 'validator:explorer:state';
const blocksKey = (limit: number) => `validator:explorer:blocks:${limit}`;

export async function getCachedValidatorExplorerState(): Promise<any | null> {
  const r = getRedis();
  if (!r) return null;
  try {
    return await r.get(STATE_KEY);
  } catch {
    return null;
  }
}

export async function setCachedValidatorExplorerState(state: any): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.set(STATE_KEY, state, { ex: TTL_SEC });
  } catch {
    /* ignore */
  }
}

export async function getCachedValidatorExplorerBlocks(limit: number): Promise<any[] | null> {
  const r = getRedis();
  if (!r) return null;
  try {
    return await r.get(blocksKey(limit));
  } catch {
    return null;
  }
}

export async function setCachedValidatorExplorerBlocks(limit: number, blocks: any[]): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.set(blocksKey(limit), blocks, { ex: TTL_SEC });
  } catch {
    /* ignore */
  }
}
