/**
 * EASTCHAIN Block Engine
 * Handles batch window (5s), VSH, empty blocks (30min if validator online)
 * Block-first atomic pattern: block created before balance updates
 */
import { ledgerPool } from './db/ledger';
import { identityPool } from './db/identity';
import { publishBlockToRailway } from './lightnode-publisher';
import { signChainHeader } from './consensus/chain-signing';
import { getDispatchHandlers, type MempoolRow } from './consensus/tx-dispatch';
import { planBlockProduction, finalizeProposal, getValidatedProduction } from './consensus/leader-schedule';
import { computeSequenceHash, computeBlockHash, computeMerkleRoot } from './consensus/block-math';

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
// Used for EMPTY blocks only (see sealBlock below). Prefers an elected
// validator that's node_type='external' (an independent node someone is
// actually running) over the internal_vercel default — otherwise the
// internal placeholder row can outrank a live external validator purely
// on total_score and end up as validator_id on every empty block even
// while external validators are online. Falls back to internal_vercel
// (or whichever row scores highest) only when no external validator is
// currently elected — the chain must never stall for lack of an empty-
// block validator.
export async function getActiveValidator(): Promise<string | null> {
  const client = await identityPool.connect();
  try {
    const res = await client.query(`
      SELECT telegram_id FROM identity.validators
      WHERE is_active = TRUE
      ORDER BY (node_type = 'external') DESC, total_score DESC
      LIMIT 1
    `);
    return res.rows[0]?.telegram_id || null;
  } finally {
    client.release();
  }
}

// ─── Core: Seal a block ──────────────────────────────────────────
async function sealBlock(
  txs: PendingTx[],
  isEmpty: boolean,
  validatorIdOverride?: string | null,
  producedBlockOverride?: { blockHash: string; merkleRoot: string; sequenceHash: string; timestampMs: number; blockIndex: number; prevHash: string } | null
): Promise<{
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

    const txHashes = txs.map(t => t.txHash);
    const freshMerkleRoot = computeMerkleRoot(txHashes);

    // If a leader's production was already verified in leader-schedule.ts
    // (see validateAndAcceptProduction), use THOSE values — that's the
    // whole point of letting the external node produce the block. We
    // still re-verify here as a final belt-and-suspenders check: the
    // leader's wait window (LEADER_WINDOW_MS, up to ~15s) is NOT covered
    // by the isProcessing single-flight guard below (that only applies
    // once THIS call reaches sealBlock) — a concurrent request (e.g. the
    // empty-block cron, or another user's claim) can seal a different
    // block in the meantime and shift the real chain tip. merkleRoot
    // alone doesn't catch that: it only depends on this block's own tx
    // hashes, which don't change — but blockHash/sequenceHash are also
    // functions of blockIndex + prevHash, and THOSE can have moved. Using
    // a stale blockHash/sequenceHash under a new index+prevHash would
    // write a block whose stored hash doesn't actually match its own
    // position in the chain. So all three must still agree, not just merkleRoot.
    let timestamp: number;
    let merkleRoot: string;
    let sequenceHash: string;
    let blockHash: string;

    const stillConsistent = producedBlockOverride
      && freshMerkleRoot === producedBlockOverride.merkleRoot
      && blockIndex === producedBlockOverride.blockIndex
      && prevHash === producedBlockOverride.prevHash;
    if (stillConsistent) {
      timestamp = producedBlockOverride!.timestampMs;
      merkleRoot = producedBlockOverride!.merkleRoot;
      sequenceHash = producedBlockOverride!.sequenceHash;
      blockHash = producedBlockOverride!.blockHash;
    } else {
      if (producedBlockOverride) {
        console.warn(`[EASTCHAIN] Block #${blockIndex}: producedBlockOverride no longer consistent with current chain tip (index/prevHash/merkleRoot shifted — likely a concurrent seal during the leader's wait window) — sealing fresh instead.`);
      }
      timestamp = Date.now();
      merkleRoot = freshMerkleRoot;
      sequenceHash = computeSequenceHash(prevHash, blockIndex, timestamp);
      blockHash = computeBlockHash(prevHash, blockIndex, merkleRoot, timestamp, txs.length);
    }

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

    const publishedHeader = {
      height: blockIndex, hash: blockHash, previousHash: prevHash, merkleRoot,
      validator: validatorId, timestamp, epoch: Math.floor(timestamp / 86_400_000),
      signature: signChainHeader(blockIndex, blockHash), // null if CHAIN_SIGNING_PRIVATE_KEY unset (secp256k1/EVM sig, see chain-signing.ts)
    };
    publishBlockToRailway(publishedHeader);
    // No R2 write here anymore — the archive route reads straight from
    // ledger.blocks on demand (see src/app/api/archive/blocks/[height]/route.ts),
    // so there's nothing to archive separately at seal time.

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
// ─── leader-proposal (1+ active external validator node) ─────────
async function attemptSealOrPropose(txs: PendingTx[], isEmpty: boolean): Promise<ReturnType<typeof sealBlock>> {
  const { blockIndex: lastIndex, blockHash: prevHash } = await getLastBlock();
  const nextBlockIndex = lastIndex + 1;
  const txHashes = txs.map(t => t.txHash);

  const plan = await planBlockProduction(nextBlockIndex, prevHash, txHashes, isEmpty);

  if (plan.mode === 'internal') {
    return sealBlock(txs, isEmpty);
  }

  // Leader-proposal mode: give the assigned node LEADER_WINDOW_MS to
  // actually COMPUTE the block (merkleRoot/sequenceHash/blockHash) and
  // submit it via /api/consensus/submit-block, where Vercel independently
  // recomputes and verifies every value before accepting. This holds the
  // current invocation open while polling — acceptable at the validator
  // counts this is designed for, same caveat as the existing in-memory mempool.
  console.log(`[EASTCHAIN] Block #${nextBlockIndex} proposed to leader ${plan.leader.telegramId} (proposal #${plan.proposalId})`);
  const attested = await plan.waitForAttestation();

  const producedBlock = attested ? await getValidatedProduction(plan.proposalId) : null;

  const result = producedBlock
    ? await sealBlock(txs, isEmpty, plan.leader.telegramId, producedBlock)
    : await sealBlock(txs, isEmpty); // fallback: self-produce, chain never stalls

  if (result.success && result.blockIndex !== undefined) {
    await finalizeProposal(plan.proposalId, !!producedBlock, result.blockIndex);
  }

  if (!producedBlock) {
    console.log(`[EASTCHAIN] Leader ${plan.leader.telegramId} missed the window (or failed verification) for block #${nextBlockIndex} — Vercel self-produced as fallback`);
  }

  return result;
}

// ─── Priority batch selection: highest gas_fee first ──────────────
// This is the actual "fee market" — a tx paying more gas jumps ahead of
// ones that arrived earlier but paid less. Array.prototype.sort is stable
// in all modern JS engines, so equal-fee tx keep their arrival order as
// the tiebreak (oldest-first), matching the ledger.mempool index too.
function selectPriorityBatch(): PendingTx[] {
  mempool.sort((a, b) => b.gasFee - a.gasFee);
  return mempool.splice(0, MAX_TX_PER_BLOCK);
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

  // If mempool full (10 tx) — seal immediately, highest gas_fee first
  if (mempool.length >= MAX_TX_PER_BLOCK) {
    if (batchTimer) { clearTimeout(batchTimer); batchTimer = null; }
    const batch = selectPriorityBatch();
    await attemptSealOrPropose(batch, false);
    return;
  }

  // Start batch window if not already running
  if (!batchTimer) {
    batchTimer = setTimeout(async () => {
      batchTimer = null;
      if (mempool.length === 0) return;
      const batch = selectPriorityBatch();
      await attemptSealOrPropose(batch, false);
    }, BATCH_WINDOW_MS);
  }
}

// submitTransaction is an alias of addToMempool — same function, clearer
// name for new call sites (see sendEast() in mining-actions.ts for the
// reference implementation: debit sender at submission time, credit
// recipient via commitFn once the batch actually seals).
export const submitTransaction = addToMempool;

// ─── Reliable queueing (fixes the critical instance-recycle bug) ──
// addToMempool()/submitTransaction() above hold commitFn/rollbackFn as
// in-memory closures triggered by a bare setTimeout — if the Vercel
// instance is frozen/recycled before that timer fires, those closures
// are lost: funds already debited at submission never get credited OR
// refunded. queueTransaction() below only writes the durable DB row
// (no closures, no timer) and sealPendingBatch() reconstructs the
// commit/rollback behavior from that row via tx-dispatch.ts's registry —
// safe to call from ANY process, including a QStash-triggered cron
// (see /api/mempool/process), which is what actually guarantees this
// tx gets processed even if the original request's instance is long gone.
export async function queueTransaction(row: MempoolRow): Promise<void> {
  const client = await ledgerPool.connect();
  try {
    await client.query(`
      INSERT INTO ledger.mempool
        (tx_hash, tx_type, sender_address, recipient_address,
         sender_id, recipient_id, amount, gas_fee, payload)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (tx_hash) DO NOTHING
    `, [
      row.txHash, row.txType, row.senderAddress, row.recipientAddress,
      row.senderId, row.recipientId, row.amount, row.gasFee,
      JSON.stringify(row.payload || {})
    ]);
  } finally {
    client.release();
  }

  // Best-effort fast path: try to seal right away if it's safe to do so.
  // Purely an optimization — if this instance dies before sealPendingBatch()
  // finishes, the row is still 'pending' in the DB and the QStash cron
  // will pick it up on its next run. Correctness never depends on this succeeding.
  sealPendingBatch().catch((err) => {
    console.error('[EASTCHAIN] Opportunistic sealPendingBatch failed (non-fatal, QStash cron will retry):', err);
  });
}

const STALE_PENDING_MS = 2 * 60 * 1000; // flag anything stuck >2 min for visibility

/**
 * Pulls up to MAX_TX_PER_BLOCK pending rows from ledger.mempool (highest
 * gas_fee first), reconstructs PendingTx objects via tx-dispatch.ts's
 * registry, and seals them. Safe to call from anywhere — this is what
 * makes sealing reliable regardless of which process/instance triggers it.
 */
export async function sealPendingBatch(): Promise<{ sealed: boolean; blockIndex?: number; count?: number }> {
  const client = await ledgerPool.connect();
  let rows: any[];
  try {
    rows = (await client.query(
      `SELECT tx_hash, tx_type, sender_id, recipient_id, sender_address, recipient_address, amount, gas_fee, payload, submitted_at
       FROM ledger.mempool WHERE status = 'pending'
       ORDER BY gas_fee DESC, submitted_at ASC LIMIT $1`,
      [MAX_TX_PER_BLOCK]
    )).rows;
  } finally {
    client.release();
  }

  if (rows.length === 0) return { sealed: false };

  // Visibility for CRITICAL fix #1's remaining edge case: if a dispatch
  // handler itself is missing/erroring repeatedly, rows would still go
  // stale — this at least surfaces it in logs rather than failing silently.
  for (const r of rows) {
    const ageMs = Date.now() - new Date(r.submitted_at).getTime();
    if (ageMs > STALE_PENDING_MS) {
      console.warn(`[EASTCHAIN] Mempool tx ${r.tx_hash} (${r.tx_type}) has been pending for ${Math.round(ageMs / 1000)}s — investigate if this recurs`);
    }
  }

  const txs: PendingTx[] = rows.map((r) => {
    const row: MempoolRow = {
      txHash: r.tx_hash, txType: r.tx_type, senderId: r.sender_id, recipientId: r.recipient_id,
      senderAddress: r.sender_address || '', recipientAddress: r.recipient_address || '',
      amount: Number(r.amount), gasFee: Number(r.gas_fee), payload: r.payload || {},
    };
    const handlers = getDispatchHandlers(r.tx_type);
    return {
      txHash: r.tx_hash, txType: r.tx_type,
      senderAddress: '', recipientAddress: '',
      senderId: r.sender_id, recipientId: r.recipient_id,
      amount: Number(r.amount), gasFee: Number(r.gas_fee), payload: r.payload,
      commitFn: async () => {
        if (!handlers) { console.error(`[EASTCHAIN] No dispatch handler registered for tx_type=${r.tx_type} — skipping commit for ${r.tx_hash}`); return; }
        await handlers.commit(row);
      },
      rollbackFn: async () => {
        if (!handlers) { console.error(`[EASTCHAIN] No dispatch handler registered for tx_type=${r.tx_type} — skipping rollback for ${r.tx_hash}`); return; }
        await handlers.rollback(row);
      },
    };
  });

  const result = await attemptSealOrPropose(txs, false);
  if (!result.success) {
    console.error(`[EASTCHAIN] sealPendingBatch: batch of ${txs.length} failed to seal:`, result.error);
    return { sealed: false };
  }
  return { sealed: true, blockIndex: result.blockIndex, count: txs.length };
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

export type TxStatusResult =
  | { found: true; status: 'confirmed'; blockIndex: number; txType: string; amount: number }
  | { found: true; status: 'pending'; txType: string; amount: number; gasFee: number; queuePosition: number }
  | { found: false };

/**
 * Polled by the client after submitTransaction() returns a pending txHash
 * (see sendEast() in mining-actions.ts). Checks the durable confirmed
 * record first, then the pending mempool row, so a status check right at
 * the seal boundary can't report "not found" for a tx that just confirmed.
 */
export async function getTransactionStatus(txHash: string): Promise<TxStatusResult> {
  const client = await ledgerPool.connect();
  try {
    const confirmed = await client.query(
      `SELECT block_index, tx_type, amount FROM ledger.transactions WHERE tx_hash = $1`,
      [txHash]
    );
    if (confirmed.rows.length > 0) {
      const r = confirmed.rows[0];
      return { found: true, status: 'confirmed', blockIndex: r.block_index, txType: r.tx_type, amount: Number(r.amount) };
    }

    const pending = await client.query(
      `SELECT tx_type, amount, gas_fee,
              (SELECT COUNT(*) FROM ledger.mempool m2
               WHERE m2.status = 'pending' AND m2.gas_fee > m1.gas_fee) AS higher_priority_count
       FROM ledger.mempool m1 WHERE tx_hash = $1 AND status = 'pending'`,
      [txHash]
    );
    if (pending.rows.length > 0) {
      const r = pending.rows[0];
      return {
        found: true, status: 'pending', txType: r.tx_type, amount: Number(r.amount),
        gasFee: Number(r.gas_fee), queuePosition: Number(r.higher_priority_count) + 1,
      };
    }

    return { found: false };
  } finally {
    client.release();
  }
}

export { sealBlock, getLastBlock, attemptSealOrPropose };
export type { PendingTx };
// Re-exported for backward compatibility — the actual implementations now
// live in ./consensus/block-math.ts (shared with leader-schedule.ts's
// verification logic). Prefer importing from there directly in new code.
export { computeSequenceHash, computeBlockHash, computeMerkleRoot } from './consensus/block-math';
