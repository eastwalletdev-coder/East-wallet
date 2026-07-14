/**
 * EASTCHAIN — Ledger ↔ R2 archive reconciliation
 * ─────────────────────────────────────────────────────────────────────
 * r2-client.ts writes fire-and-forget: if a PUT to R2 fails (network
 * blip, misconfigured bucket, credential issue) it just console.errors
 * and moves on, since an archive outage should never block a real claim
 * from sealing. That's the right call for the write path, but it means
 * nothing ever re-checks whether those writes actually landed, or
 * whether an archived object still matches what's in ledger.blocks
 * (Postgres remains canonical throughout — see r2-client.ts).
 *
 * This compares, for a given height range:
 *   - missing_in_r2  — DB has the block, R2 has no object for it
 *   - hash_mismatch  — R2 has an object, but its hash differs from the DB
 *
 * Both are self-healed by rebuilding the header FROM THE DB ROW (never
 * from the old/mismatched R2 object) and re-writing it to R2. Re-signing
 * is safe here: signChainHeader() is Ed25519 (EdDSA), which is
 * deterministic for a given message + key — re-running it on the same
 * (height, hash) reproduces the exact signature issued at seal time,
 * nothing is being freshly "vouched for" here.
 *
 * A third case — R2's "latest" pointer claiming a height the DB doesn't
 * have — is NOT self-healed. Fixing that would mean deleting data from
 * R2, which this module deliberately never does; it's only flagged via
 * checkOrphanedArchiveTip() for a human to look at.
 */
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { ledgerPool } from '@/lib/db/ledger';
import { signChainHeader } from '@/lib/consensus/chain-signing';
import { archiveBlockToR2, type ArchivedBlockHeader } from './r2-client';

const RECONCILE_BATCH_CONCURRENCY = 8;

let cachedClient: S3Client | null = null;

function getReadClient(): S3Client | null {
  const accountId = process.env.CLOUDFLARE_R2_ACCOUNT_ID;
  const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) return null;

  if (!cachedClient) {
    cachedClient = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  return cachedClient;
}

async function getArchivedHeader(bucket: string, height: number): Promise<ArchivedBlockHeader | null> {
  const client = getReadClient();
  if (!client) return null;
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: `blocks/${height}.json` }));
    const body = await res.Body?.transformToString();
    return body ? (JSON.parse(body) as ArchivedBlockHeader) : null;
  } catch {
    return null; // NoSuchKey (or any other fetch error) — treated as missing
  }
}

async function getLatestPointer(bucket: string): Promise<{ height: number; hash: string } | null> {
  const client = getReadClient();
  if (!client) return null;
  try {
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: 'latest.json' }));
    const body = await res.Body?.transformToString();
    if (!body) return null;
    const parsed = JSON.parse(body);
    return { height: parsed.height, hash: parsed.hash };
  } catch {
    return null;
  }
}

export interface DiscrepancyResult {
  blockIndex: number;
  type: 'missing_in_r2' | 'hash_mismatch';
  dbHash: string;
  r2Hash: string | null;
  healed: boolean;
}

/**
 * Checks every height in [fromHeight, toHeight] that the DB actually has a
 * block for, against R2. Any mismatch is immediately re-archived from the
 * DB row and logged to ledger.archive_discrepancies (whether or not the
 * re-archive succeeded — heal_result records that).
 */
export async function reconcileRange(
  fromHeight: number,
  toHeight: number
): Promise<{ checked: number; discrepancies: DiscrepancyResult[] }> {
  const bucket = process.env.CLOUDFLARE_R2_BUCKET;
  const discrepancies: DiscrepancyResult[] = [];
  if (!bucket || fromHeight > toHeight) return { checked: 0, discrepancies };

  const dbClient = await ledgerPool.connect();
  let dbRows: any[];
  try {
    const res = await dbClient.query(
      `SELECT block_index, block_hash, prev_hash, merkle_root, validator_id, created_at
       FROM ledger.blocks WHERE block_index BETWEEN $1 AND $2 ORDER BY block_index ASC`,
      [fromHeight, toHeight]
    );
    dbRows = res.rows;
  } finally {
    dbClient.release();
  }

  const dbByHeight = new Map(dbRows.map((r) => [r.block_index, r]));
  const heights = dbRows.map((r) => r.block_index); // only heights the DB actually has

  for (let i = 0; i < heights.length; i += RECONCILE_BATCH_CONCURRENCY) {
    const batch = heights.slice(i, i + RECONCILE_BATCH_CONCURRENCY);
    await Promise.all(
      batch.map(async (h) => {
        const dbRow = dbByHeight.get(h);
        const archived = await getArchivedHeader(bucket, h);

        let type: DiscrepancyResult['type'] | null = null;
        if (!archived) type = 'missing_in_r2';
        else if (archived.hash !== dbRow.block_hash) type = 'hash_mismatch';
        if (!type) return; // matches — nothing to do

        // Rebuild strictly from the DB row (never from the stale/mismatched
        // R2 object) and re-write. Deterministic Ed25519 re-sign — see
        // module comment above.
        const correctHeader: ArchivedBlockHeader = {
          height: dbRow.block_index,
          hash: dbRow.block_hash,
          previousHash: dbRow.prev_hash,
          merkleRoot: dbRow.merkle_root ?? '',
          validator: dbRow.validator_id,
          timestamp: new Date(dbRow.created_at).getTime(),
          epoch: Math.floor(new Date(dbRow.created_at).getTime() / 86_400_000),
          signature: signChainHeader(dbRow.block_index, dbRow.block_hash),
        };

        let healed = false;
        try {
          await archiveBlockToR2(correctHeader);
          healed = true;
        } catch (err) {
          console.error(`[EASTCHAIN] Reconcile: re-archive failed for block #${h}:`, err);
        }

        discrepancies.push({
          blockIndex: h, type, dbHash: dbRow.block_hash, r2Hash: archived?.hash ?? null, healed,
        });
      })
    );
  }

  if (discrepancies.length > 0) {
    const logClient = await ledgerPool.connect();
    try {
      for (const d of discrepancies) {
        await logClient.query(
          `INSERT INTO ledger.archive_discrepancies (block_index, discrepancy_type, db_hash, r2_hash, healed_at, heal_result)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [d.blockIndex, d.type, d.dbHash, d.r2Hash, d.healed ? new Date() : null, d.healed ? 'healed' : 'heal_failed']
        );
      }
    } finally {
      logClient.release();
    }
  }

  return { checked: heights.length, discrepancies };
}

/**
 * Advances the rolling reconciliation watermark by up to maxBlocksPerRun
 * blocks and checks that range. Shared by /api/epoch (piggybacking on the
 * existing 24h QStash trigger — no separate schedule needed) and the
 * manual /api/admin/reconcile-archive endpoint's rolling mode.
 */
export async function runRollingReconciliation(maxBlocksPerRun = 2000): Promise<{
  range: { fromHeight: number; toHeight: number } | null;
  checked: number;
  discrepancies: DiscrepancyResult[];
  orphanedArchiveTip: { anomaly: boolean; r2Height?: number; dbHeight: number } | null;
}> {
  const client = await ledgerPool.connect();
  let dbMaxHeight: number;
  try {
    const res = await client.query('SELECT MAX(block_index) AS max FROM ledger.blocks');
    dbMaxHeight = res.rows[0]?.max ?? -1;
  } finally {
    client.release();
  }

  const wmClient = await ledgerPool.connect();
  let watermark: number;
  try {
    const wmRes = await wmClient.query("SELECT value FROM ledger.chain_meta WHERE key = 'last_reconciled_height'");
    watermark = wmRes.rows.length > 0 ? parseInt(wmRes.rows[0].value) : -1;
  } finally {
    wmClient.release();
  }

  const fromHeight = watermark + 1;
  const toHeight = Math.min(dbMaxHeight, fromHeight + maxBlocksPerRun - 1);

  if (fromHeight > toHeight) {
    return { range: null, checked: 0, discrepancies: [], orphanedArchiveTip: null };
  }

  const { checked, discrepancies } = await reconcileRange(fromHeight, toHeight);
  const orphanCheck = await checkOrphanedArchiveTip();

  const advanceClient = await ledgerPool.connect();
  try {
    await advanceClient.query(
      `INSERT INTO ledger.chain_meta (key, value)
       VALUES ('last_reconciled_height', $1)
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [String(toHeight)]
    );
  } finally {
    advanceClient.release();
  }

  return {
    range: { fromHeight, toHeight },
    checked,
    discrepancies,
    orphanedArchiveTip: orphanCheck.anomaly ? orphanCheck : null,
  };
}

/**
 * R2's "latest" pointer claiming a height beyond what the DB has would
 * mean an object exists in the archive for a block that was never sealed
 * — deliberately NOT auto-resolved (the only fix is deleting from R2,
 * which this module never does). Logged for a human to investigate.
 */
export async function checkOrphanedArchiveTip(): Promise<{ anomaly: boolean; r2Height?: number; dbHeight: number }> {
  const bucket = process.env.CLOUDFLARE_R2_BUCKET;
  const dbClient = await ledgerPool.connect();
  let dbHeight: number;
  try {
    const res = await dbClient.query('SELECT MAX(block_index) AS max FROM ledger.blocks');
    dbHeight = res.rows[0]?.max ?? -1;
  } finally {
    dbClient.release();
  }

  if (!bucket) return { anomaly: false, dbHeight };
  const pointer = await getLatestPointer(bucket);
  if (!pointer) return { anomaly: false, dbHeight };

  if (pointer.height > dbHeight) {
    console.warn(`[EASTCHAIN] Reconcile: R2 latest.json claims height #${pointer.height}, DB only has up to #${dbHeight} — flagged, not auto-resolved`);
    return { anomaly: true, r2Height: pointer.height, dbHeight };
  }
  return { anomaly: false, r2Height: pointer.height, dbHeight };
}
