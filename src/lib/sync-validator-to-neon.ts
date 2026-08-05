/**
 * Mirror east-validator tip → Neon ledger.blocks (+ chain_meta).
 * Explorer keeps reading Neon (getChainState / getRecentBlocks) + Redis.
 * Validator remains source of truth for balances/tx; Neon is read replica for UI.
 *
 * No dependency on redis-chain-explorer (optional package).
 */
import { ledgerPool } from '@/lib/db/ledger';

function validatorBase(): string {
  return (process.env.EAST_VALIDATOR_URL || process.env.VALIDATOR_HTTP_URL || '')
    .trim()
    .replace(/\/$/, '');
}

function hubBase(): string {
  return (process.env.RAILWAY_HUB_URL || process.env.EAST_HUB_URL || '')
    .trim()
    .replace(/\/$/, '');
}

async function fetchJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function chainGet(path: string): Promise<any | null> {
  const p = path.startsWith('/') ? path : `/${path}`;
  const hub = hubBase();
  const val = validatorBase();
  if (hub) {
    for (const u of [`${hub}/rpc${p}`, `${hub}${p}`]) {
      const j = await fetchJson(u);
      if (j) return j;
    }
  }
  if (val) return fetchJson(`${val}${p}`);
  return null;
}

export type SyncResult = {
  ok: boolean;
  tip: number;
  inserted: number;
  skipped: number;
  error?: string;
};

/**
 * Pull last `lookback` blocks from validator and upsert into ledger.blocks.
 * Safe to run every 30–60s via QStash.
 */
export async function syncValidatorBlocksToNeon(lookback = 20): Promise<SyncResult> {
  const latest = await chainGet('/block/latest');
  if (!latest || latest.height == null) {
    return { ok: false, tip: -1, inserted: 0, skipped: 0, error: 'block_latest_unreachable' };
  }

  const tip = Number(latest.height) || 0;
  const start = Math.max(0, tip - lookback + 1);
  let inserted = 0;
  let skipped = 0;

  const client = await ledgerPool.connect();
  try {
    await client.query('BEGIN');

    for (let h = start; h <= tip; h++) {
      const block = h === tip ? latest : await chainGet(`/block/${h}`);
      if (!block || block.height == null) {
        skipped++;
        continue;
      }

      const blockIndex = Number(block.height) || 0;
      const blockHash = String(block.hash || `height-${blockIndex}`);
      const prevHash = String(block.prev_hash || 'GENESIS');
      const txCount = Number(block.tx_count || 0) || 0;
      const proposer = String(block.proposer || 'validator');
      const ts = Number(block.timestamp || Date.now());
      const sequenceHash = String(block.state_root || block.hash || blockHash);
      const merkle = Array.isArray(block.tx_hashes)
        ? String(block.tx_hashes[0] || blockHash)
        : blockHash;

      const exists = await client.query(
        `SELECT 1 FROM ledger.blocks WHERE block_index = $1 OR block_hash = $2 LIMIT 1`,
        [blockIndex, blockHash],
      );
      if (exists.rows.length) {
        skipped++;
        continue;
      }

      await client.query(
        `INSERT INTO ledger.blocks
          (block_index, block_hash, prev_hash, sequence_hash, merkle_root,
           tx_count, total_gas, is_empty, validator_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,0,$7,$8, to_timestamp($9::double precision / 1000.0))
         ON CONFLICT (block_hash) DO NOTHING`,
        [
          blockIndex,
          blockHash.slice(0, 66),
          prevHash.slice(0, 66),
          sequenceHash.slice(0, 66),
          merkle.slice(0, 66),
          txCount,
          txCount === 0,
          proposer.slice(0, 50),
          ts > 1e12 ? ts : ts * 1000,
        ],
      );
      inserted++;
    }

    await client.query(
      `INSERT INTO ledger.chain_meta (key, value, updated_at)
       VALUES ('validator_tip_height', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [String(tip)],
    );
    await client.query(
      `INSERT INTO ledger.chain_meta (key, value, updated_at)
       VALUES ('validator_tip_hash', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [String(latest.hash || '')],
    );
    await client.query(
      `INSERT INTO ledger.chain_meta (key, value, updated_at)
       VALUES ('validator_synced_at', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [new Date().toISOString()],
    );

    await client.query('COMMIT');
  } catch (e: any) {
    await client.query('ROLLBACK').catch(() => {});
    return {
      ok: false,
      tip,
      inserted,
      skipped,
      error: e?.message || 'sync_failed',
    };
  } finally {
    client.release();
  }

  // Invalidate Neon explorer Redis caches (optional)
  try {
    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
      const { Redis } = await import('@upstash/redis');
      const r = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      });
      await r.del('chainstate:latest');
      await r.del('explorer:blocks:10');
      await r.del('explorer:blocks:15');
    }
  } catch {
    /* ignore */
  }

  return { ok: true, tip, inserted, skipped };
}
