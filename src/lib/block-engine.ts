/**
 * EASTCHAIN Block Engine
 * Handles batch window (5s), VSH, empty blocks (30min if validator online)
 * Block-first atomic pattern: block created before balance updates
 */
import { createHash } from 'crypto';
import { ledgerPool } from './db/ledger';
import { identityPool } from './db/identity';
import { publishBlockToRailway } from './lightnode-publisher';
import { planBlockProduction, finalizeProposal } from './consensus/leader-schedule';

const BATCH_WINDOW_MS = 5_000;       // 5 seconds batch window
const MAX_TX_PER_BLOCK = 10;         // max tx per block
const EMPTY_BLOCK_INTERVAL_MS = 30 * 60 * 1_000; // 30 minutes

// In-memory mempool (also persisted to DB)
interface PendingTx {
  txHash: string;
  txType: string;
  senderAddress: string;
  recipientAddress: string;
  senderId: string;
  recipientId: string;
  amount: number;
  gasFee: number;
  payload: any;
  // Deferred balance update functions (run AFTER block confirmed)
  commitFn: () => Promise<void>;
  rollbackFn: () => Promise<void>;
}

let mempool: PendingTx[] = [];
let batchTimer: ReturnType<typeof setTimeout> | null = null;
let emptyBlockTimer: ReturnType<typeof setInterval> | null = null;
let isProcessing = false;

// ─── VSH: Verifiable Sequence Hash ───────────────────────────────
export function computeSequenceHash(
  prevBlockHash: string,
  blockIndex: number,
  timestampMs: number
): string {
  const payload = `${prevBlockHash}|${blockIndex}|${timestampMs}`;
  return '0x' + createHash('sha256').update(payload).digest('hex');
}

// ─── Block Hash ───────────────────────────────────────────────────
export function computeBlockHash(
  prevHash: string,
  blockIndex: number,
  merkleRoot: string,
  timestampMs: number,
  txCount: number
): string {
  const payload = `${prevHash}|${blockIndex}|${merkleRoot}|${timestampMs}|${txCount}`;
  return '0x' + createHash('sha256').update(payload).digest('hex');
}

// ─── Merkle Root ──────────────────────────────────────────────────
export function computeMerkleRoot(txHashes: string[]): string {
  if (txHashes.length === 0) return '0x' + '0'.repeat(64);
  if (txHashes.length === 1) return txHashes[0];
  let layer = [...txHashes];
  while (layer.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i];
      const right = layer[i + 1] || layer[i];
      next.push('0x' + createHash('sha256').update(left + right).digest('hex'));
    }
    layer = next;
  }
  return layer[0];
}

// ─── Get last block info ──────────────────────────────────────────
async function getLastBlock(): Promise<{ blockIndex: number; blockHash: string }> {
  const client = await ledgerPool.connect();
  try {
    const res = await client.query(
      'SELECT block_index, block_hash FROM ledger.blocks ORDER BY chain_seq DESC LIMIT 1'
    );
    if (res.rows.length === 0) return { blockIndex: -1, blockHash: 'GENESIS' };
    return { blockIndex: res.rows[0].block_index, blockHash: res.rows[0].block_hash };
  } finally {
    client.release();
  }
}

// ─── Get active validator ─────────────────────────────────────────
export async function getActiveValidator(): Promise<string | null> {
  const client = await identityPool.connect();
  try {
    const res = await client.query(`
      SELECT telegram_id FROM identity.validators
      WHERE is_active = TRUE
      ORDER BY total_score DESC
      LIMIT 1
    `);
    return res.rows[0]?.telegram_id || null;
  } finally {
    client.release();
  }
}

// ─── Core: Seal a block ──────────────────────────────────────────
async function sealBlock(txs: PendingTx[], isEmpty: boolean, validatorIdOverride?: string | null): Promise<{
  success: boolean;
  blockIndex?: number;
  blockHash?: string;
  sequenceHash?: string;
  error?: string;
}> {
  if (isProcessing) return { success: false, error: 'BLOCK_ENGINE_BUSY' };
  isProcessing = true;

  const ledgerClient = await ledgerPool.connect();
  const identityClient = await identityPool.connect();

  try {
    await ledgerClient.query('BEGIN');
    await identityClient.query('BEGIN');

    const { blockIndex: lastIndex, blockHash: prevHash } = await getLastBlock();
    const blockIndex = lastIndex + 1;
    const timestamp = Date.now();

    const txHashes = txs.map(t => t.txHash);
    const merkleRoot = computeMerkleRoot(txHashes);
    const sequenceHash = computeSequenceHash(prevHash, blockIndex, timestamp);
    const blockHash = computeBlockHash(prevHash, blockIndex, merkleRoot, timestamp, txs.length);

    // Get validator for empty blocks (required for Opsi 2), unless the
    // caller already resolved one via leader-proposal mode (see
    // attemptSealOrPropose / leader-schedule.ts) — an override always wins.
    let validatorId: string | null = validatorIdOverride ?? null;
    if (!validatorId && isEmpty) {
      validatorId = await getActiveValidator();
      if (!validatorId) {
        // No active validator — skip empty block
        await ledgerClient.query('ROLLBACK');
        await identityClient.query('ROLLBACK');
        isProcessing = false;
        return { success: false, error: 'NO_ACTIVE_VALIDATOR' };
      }
    }

    // 1. Create block FIRST (block-first atomic pattern)
    await ledgerClient.query(`
      INSERT INTO ledger.blocks
        (block_index, block_hash, prev_hash, sequence_hash, merkle_root,
         tx_count, total_gas, is_empty, validator_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `, [
      blockIndex, blockHash, prevHash, sequenceHash, merkleRoot,
      txs.length, txs.reduce((s, t) => s + t.gasFee, 0),
      isEmpty, validatorId
    ]);

    publishBlockToRailway({
      height: blockIndex, hash: blockHash, previousHash: prevHash, merkleRoot,
      validator: validatorId, timestamp, epoch: Math.floor(timestamp / 86_400_000),
    });

    // 2. Insert all transactions
    for (const tx of txs) {
      await ledgerClient.query(`
        INSERT INTO ledger.transactions
          (tx_hash, block_index, tx_type, sender_address, recipient_address,
           sender_id, recipient_id, amount, gas_fee, status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'confirmed')
      `, [
        tx.txHash, blockIndex, tx.txType,
        tx.senderAddress, tx.recipientAddress,
        tx.senderId, tx.recipientId,
        tx.amount, tx.gasFee
      ]);

      // Log to saga
      await ledgerClient.query(`
        INSERT INTO ledger.saga_log (tx_hash, step, status)
        VALUES ($1, 'block_created', 'completed')
      `, [tx.txHash]);
    }

    // 3. Set genesis on first block
    if (blockIndex === 0) {
      await ledgerClient.query(`
        INSERT INTO ledger.chain_meta (key, value)
        VALUES ('genesis_timestamp', $1) ON CONFLICT (key) DO NOTHING
      `, [new Date(timestamp).toISOString()]);
    }

    // 4. Commit ledger FIRST
    await ledgerClient.query('COMMIT');

    // 5. NOW update balances (after block confirmed)
    try {
      for (const tx of txs) {
        await tx.commitFn();
        await ledgerClient.query(`
          INSERT INTO ledger.saga_log (tx_hash, step, status)
          VALUES ($1, 'balance_updated', 'completed')
        `, [tx.txHash]);
      }
      await identityClient.query('COMMIT');
    } catch (balanceErr) {
      // Block already committed — flag for reconciliation
      await identityClient.query('ROLLBACK');
      console.error('[EASTCHAIN] RECONCILIATION NEEDED — block committed but balance update failed:', balanceErr);
      for (const tx of txs) {
        await ledgerClient.query(`
          INSERT INTO ledger.saga_log (tx_hash, step, status, error)
          VALUES ($1, 'balance_update_failed', 'reconciling', $2)
        `, [tx.txHash, String(balanceErr)]);
      }
    }

    // 6. Remove from mempool
    await ledgerClient.query(
      `DELETE FROM ledger.mempool WHERE tx_hash = ANY($1)`,
      [txHashes]
    );

    console.log(`[EASTCHAIN] Block #${blockIndex} sealed — ${txs.length} tx, hash: ${blockHash.substring(0, 12)}...`);

    return { success: true, blockIndex, blockHash, sequenceHash };

  } catch (err: any) {
    await ledgerClient.query('ROLLBACK');
    await identityClient.query('ROLLBACK');
    // Rollback all pending balances
    for (const tx of txs) {
      try { await tx.rollbackFn(); } catch {}
    }
    console.error('[EASTCHAIN] Block seal failed:', err);
    return { success: false, error: err.message };
  } finally {
    isProcessing = false;
    ledgerClient.release();
    identityClient.release();
  }
}

// ─── Mode-switching wrapper: internal (Vercel self-produce) vs ───
// ─── leader-proposal (2+ active external validator nodes) ────────
async function attemptSealOrPropose(txs: PendingTx[], isEmpty: boolean): Promise<ReturnType<typeof sealBlock>> {
  const { blockIndex: lastIndex } = await getLastBlock();
  const nextBlockIndex = lastIndex + 1;
  const txHashes = txs.map(t => t.txHash);

  const plan = await planBlockProduction(nextBlockIndex, txHashes, isEmpty);

  if (plan.mode === 'internal') {
    return sealBlock(txs, isEmpty);
  }

  // Leader-proposal mode: give the assigned node LEADER_WINDOW_MS to
  // counter-sign via /api/consensus/submit-block. This holds the current
  // invocation open while polling — acceptable at the validator counts
  // this is designed for, same caveat as the existing in-memory mempool.
  console.log(`[EASTCHAIN] Block #${nextBlockIndex} proposed to leader ${plan.leader.telegramId} (proposal #${plan.proposalId})`);
  const attested = await plan.waitForAttestation();

  const result = attested
    ? await sealBlock(txs, isEmpty, plan.leader.telegramId)
    : await sealBlock(txs, isEmpty); // fallback: self-produce, chain never stalls

  if (result.success && result.blockIndex !== undefined) {
    await finalizeProposal(plan.proposalId, attested, result.blockIndex);
  }

  if (!attested) {
    console.log(`[EASTCHAIN] Leader ${plan.leader.telegramId} missed the window for block #${nextBlockIndex} — Vercel self-produced as fallback`);
  }

  return result;
}

// ─── Public: Add tx to mempool + start batch window ──────────────
export async function addToMempool(tx: PendingTx): Promise<void> {
  mempool.push(tx);

  // Persist to DB mempool
  const client = await ledgerPool.connect();
  try {
    await client.query(`
      INSERT INTO ledger.mempool
        (tx_hash, tx_type, sender_address, recipient_address,
         sender_id, recipient_id, amount, gas_fee, payload)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (tx_hash) DO NOTHING
    `, [
      tx.txHash, tx.txType, tx.senderAddress, tx.recipientAddress,
      tx.senderId, tx.recipientId, tx.amount, tx.gasFee,
      JSON.stringify(tx.payload || {})
    ]);
  } finally {
    client.release();
  }

  // If mempool full (10 tx) — seal immediately
  if (mempool.length >= MAX_TX_PER_BLOCK) {
    if (batchTimer) { clearTimeout(batchTimer); batchTimer = null; }
    const batch = mempool.splice(0, MAX_TX_PER_BLOCK);
    await attemptSealOrPropose(batch, false);
    return;
  }

  // Start batch window if not already running
  if (!batchTimer) {
    batchTimer = setTimeout(async () => {
      batchTimer = null;
      if (mempool.length === 0) return;
      const batch = mempool.splice(0, MAX_TX_PER_BLOCK);
      await attemptSealOrPropose(batch, false);
    }, BATCH_WINDOW_MS);
  }
}

// ─── Empty block scheduler (30 min, validator required) ──────────
export function startEmptyBlockScheduler() {
  if (emptyBlockTimer) clearInterval(emptyBlockTimer);
  emptyBlockTimer = setInterval(async () => {
    if (mempool.length > 0) return; // Skip if there are pending tx
    await attemptSealOrPropose([], true);
  }, EMPTY_BLOCK_INTERVAL_MS);
  console.log('[EASTCHAIN] Empty block scheduler started (30 min interval, validator required)');
}

export function stopEmptyBlockScheduler() {
  if (emptyBlockTimer) { clearInterval(emptyBlockTimer); emptyBlockTimer = null; }
}

export { sealBlock, getLastBlock, attemptSealOrPropose };
export type { PendingTx };
