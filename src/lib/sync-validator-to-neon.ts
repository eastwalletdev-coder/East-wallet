/**
 * Mirror validator headers → Neon ledger.blocks (archive).
 * Upserts by block_index so Railway heights replace stale Neon-L2 rows.
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
  updated: number;
  skipped: number;
  error?: string;
};

/**
 * lookback: how many heights below tip to pull.
 * mode=upsert: replace Neon row at same block_index when hash differs (archive = validator).
 */
export async function syncValidatorBlocksToNeon(lookback = 50): Promise<SyncResult> {
  const latest = await chainGet('/block/latest');
  if (!latest || latest.height == null) {
    return { ok: false, tip: -1, inserted: 0, updated: 0, skipped: 0, error: 'block_latest_unreachable' };
  }

  const tip = Number(latest.height) || 0;
  const start = Math.max(0, tip - lookback + 1);
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  const client = await ledgerPool.connect();
  try {
    await client.query('BEGIN');

    // Ensure archive marker column exists (idempotent)
    await client.query(`
      ALTER TABLE ledger.blocks
      ADD COLUMN IF NOT EXISTS chain_source VARCHAR(32) DEFAULT NULL
    `).catch(() => {});

    for (let h = start; h <= tip; h++) {
      const block = h === tip ? latest : await chainGet(`/block/${h}`);
      if (!block || block.height == null) {
        skipped++;
        continue;
      }

      const blockIndex = Number(block.height) || 0;
      const blockHash = String(block.hash || `height-${blockIndex}`).slice(0, 66);
      const prevHash = String(block.prev_hash || 'GENESIS').slice(0, 66);
      const txCount = Number(block.tx_count || 0) || 0;
      const proposer = String(block.proposer || 'validator').slice(0, 50);
      const ts = Number(block.timestamp || Date.now());
      const tsMs = ts > 1e12 ? ts : ts * 1000;
      const sequenceHash = String(block.state_root || block.hash || blockHash).slice(0, 66);
      const merkle = Array.isArray(block.tx_hashes)
        ? String(block.tx_hashes[0] || blockHash).slice(0, 66)
        : blockHash;

      const existing = await client.query(
        `SELECT block_hash, chain_source FROM ledger.blocks WHERE block_index = $1 LIMIT 1`,
        [blockIndex],
      );

      if (existing.rows.length) {
        const row = existing.rows[0];
        if (row.block_hash === blockHash && row.chain_source === 'validator') {
          skipped++;
          continue;
        }
        // Replace stale Neon-L2 or different hash at same height
        await client.query(
          `UPDATE ledger.blocks SET
             block_hash = $2,
             prev_hash = $3,
             sequence_hash = $4,
             merkle_root = $5,
             tx_count = $6,
             is_empty = $7,
             validator_id = $8,
             created_at = to_timestamp($9::double precision / 1000.0),
             chain_source = 'validator'
           WHERE block_index = $1`,
          [blockIndex, blockHash, prevHash, sequenceHash, merkle, txCount, txCount === 0, proposer, tsMs],
        );
        updated++;
        continue;
      }

      await client.query(
        `INSERT INTO ledger.blocks
          (block_index, block_hash, prev_hash, sequence_hash, merkle_root,
           tx_count, total_gas, is_empty, validator_id, created_at, chain_source)
         VALUES ($1,$2,$3,$4,$5,$6,0,$7,$8, to_timestamp($9::double precision / 1000.0), 'validator')
         ON CONFLICT (block_hash) DO UPDATE SET
           block_index = EXCLUDED.block_index,
           prev_hash = EXCLUDED.prev_hash,
           sequence_hash = EXCLUDED.sequence_hash,
           chain_source = 'validator'`,
        [blockIndex, blockHash, prevHash, sequenceHash, merkle, txCount, txCount === 0, proposer, tsMs],
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
       VALUES ('archive_role', 'validator_headers', NOW())
       ON CONFLICT (key) DO UPDATE SET value = 'validator_headers', updated_at = NOW()`,
    );

    await client.query('COMMIT');
  } catch (e: any) {
    await client.query('ROLLBACK').catch(() => {});
    return {
      ok: false,
      tip,
      inserted,
      updated,
      skipped,
      error: e?.message || 'sync_failed',
    };
  } finally {
    client.release();
  }

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

  return { ok: true, tip, inserted, updated, skipped };
}
