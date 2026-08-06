import { ledgerPool } from '@/lib/db/ledger';

export type ArchiveHeader = {
  height: number;
  hash: string;
  prev_hash: string;
  state_root: string;
  tx_count: number;
  timestamp: number;
  proposer: string;
  source: string;
};

/**
 * Headers from Neon archive (validator-sourced rows preferred).
 * fromHeight..toHeight inclusive, ascending.
 */
export async function getArchiveHeaders(
  fromHeight: number,
  toHeight: number,
  limit = 100,
): Promise<ArchiveHeader[]> {
  const from = Math.max(0, Math.floor(fromHeight));
  const to = Math.max(from, Math.floor(toHeight));
  const lim = Math.min(200, Math.max(1, limit));

  const client = await ledgerPool.connect();
  try {
    // Prefer chain_source = validator; fall back to any row at height
    const res = await client.query(
      `SELECT block_index, block_hash, prev_hash, sequence_hash, tx_count,
              EXTRACT(EPOCH FROM created_at) * 1000 AS ts_ms,
              validator_id, COALESCE(chain_source, 'legacy') AS chain_source
       FROM ledger.blocks
       WHERE block_index >= $1 AND block_index <= $2
       ORDER BY block_index ASC
       LIMIT $3`,
      [from, to, lim],
    );

    return res.rows.map((r: any) => ({
      height: Number(r.block_index),
      hash: String(r.block_hash || ''),
      prev_hash: String(r.prev_hash || 'GENESIS'),
      state_root: String(r.sequence_hash || r.block_hash || ''),
      tx_count: Number(r.tx_count || 0),
      timestamp: Number(r.ts_ms) || Date.now(),
      proposer: String(r.validator_id || ''),
      source: String(r.chain_source || 'legacy'),
    }));
  } finally {
    client.release();
  }
}

export async function getArchiveTip(): Promise<{ height: number; hash: string; source: string } | null> {
  const client = await ledgerPool.connect();
  try {
    const meta = await client.query(
      `SELECT key, value FROM ledger.chain_meta
       WHERE key IN ('validator_tip_height', 'validator_tip_hash')`,
    );
    const map: Record<string, string> = {};
    for (const r of meta.rows) map[r.key] = r.value;

    if (map.validator_tip_height != null) {
      return {
        height: Number(map.validator_tip_height) || 0,
        hash: map.validator_tip_hash || '',
        source: 'chain_meta',
      };
    }

    const res = await client.query(
      `SELECT block_index, block_hash, COALESCE(chain_source,'legacy') AS src
       FROM ledger.blocks
       WHERE COALESCE(chain_source, '') = 'validator'
       ORDER BY block_index DESC LIMIT 1`,
    );
    if (!res.rows.length) {
      const any = await client.query(
        `SELECT block_index, block_hash FROM ledger.blocks ORDER BY block_index DESC LIMIT 1`,
      );
      if (!any.rows.length) return null;
      return {
        height: Number(any.rows[0].block_index),
        hash: any.rows[0].block_hash,
        source: 'legacy_max',
      };
    }
    return {
      height: Number(res.rows[0].block_index),
      hash: res.rows[0].block_hash,
      source: 'validator_rows',
    };
  } finally {
    client.release();
  }
}
