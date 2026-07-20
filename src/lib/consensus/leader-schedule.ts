/**
 * EASTCHAIN — Leader schedule / block proposals
 * ─────────────────────────────────────────────────────────────────────
 * Once 2+ external validator nodes are genuinely live, Vercel assigns the
 * next block slot to a deterministically-picked leader and gives it a
 * short window to actually COMPUTE and submit the block (merkleRoot,
 * sequenceHash, blockHash) rather than just counter-signing a fixed
 * string. Vercel independently recomputes every value from its own
 * trusted inputs (prev_hash + tx_hashes it already has) and ONLY accepts
 * the submission if every value matches exactly — any mismatch (wrong
 * prevHash, wrong blockHash, bad signature, timestamp out of bounds) is
 * rejected with a specific reason and logged, and the slot falls back to
 * Vercel self-producing so the chain never stalls.
 *
 * What is still NOT decentralized: applying the block's side effects
 * (balance updates via commitFn/rollbackFn) — those closures only exist
 * in the Vercel instance holding the original transactions, so sealBlock()
 * in block-engine.ts is still the one writing to the DB. What changes
 * here is that when a leader submission is accepted, sealBlock() uses
 * the EXTERNALLY-COMPUTED (but Vercel-verified) blockHash/merkleRoot/
 * sequenceHash/timestamp — not values Vercel invented itself.
 *
 * "Active external node" = identity.validators row with node_type='external'
 * AND a heartbeat inside HEARTBEAT_FRESHNESS_SECONDS AND a registered
 * self-custody pubkey. See identity.ts for the underlying columns/queries.
 */

import { ledgerPool } from '@/lib/db/ledger';
import { getActiveExternalValidators } from '@/lib/db/identity';
import { verifySignature } from '@/lib/keypair-service';
import { setCachedProposal } from '@/lib/db/redis';
import {
  computeMerkleRoot,
  computeSequenceHash,
  computeBlockHash,
  buildProductionMessage,
  MAX_PRODUCTION_CLOCK_SKEW_MS,
} from '@/lib/consensus/block-math';

export const LEADER_WINDOW_MS = 15_000; // how long a leader has to produce + submit
const POLL_INTERVAL_MS = 2_000;

export type LeaderAssignment = {
  telegramId: string;
  pubkeyHex: string;
};

export type ValidatedProduction = {
  blockHash: string;
  merkleRoot: string;
  sequenceHash: string;
  timestampMs: number;
};

/**
 * Deterministic round-robin: same block index always picks the same
 * leader given the same active-validator set, so any node could recompute
 * this independently rather than trusting Vercel's word for it.
 */
export function pickLeader(
  activeExternalValidators: Array<{ telegramId: string; selfCustodyPubkey: string | null }>,
  blockIndex: number
): LeaderAssignment | null {
  if (activeExternalValidators.length === 0) return null;
  const idx = ((blockIndex % activeExternalValidators.length) + activeExternalValidators.length) % activeExternalValidators.length;
  const chosen = activeExternalValidators[idx];
  if (!chosen.selfCustodyPubkey) return null;
  return { telegramId: chosen.telegramId, pubkeyHex: chosen.selfCustodyPubkey };
}

/** True once 2+ external nodes are genuinely live — the mode-switch condition. */
export async function isLeaderProposalModeActive(): Promise<boolean> {
  const active = await getActiveExternalValidators();
  return active.length >= 2;
}

/**
 * Lightweight, NON-blocking producer resolution for the real, live
 * direct-seal path (mining-actions.ts and the contract files). See
 * block-engine.ts's header comment for why the proposal/production
 * machinery below does NOT sit on that path — holding a DB transaction
 * open for a 15s handshake would freeze the user's request.
 */
export async function resolveBlockProducer(blockIndex: number): Promise<string | null> {
  const activeExternal = await getActiveExternalValidators();
  if (activeExternal.length < 2) return null;
  const leader = pickLeader(activeExternal, blockIndex);
  return leader?.telegramId ?? null;
}

async function createProposal(
  blockIndex: number,
  prevHash: string,
  txHashes: string[],
  isEmpty: boolean,
  leader: LeaderAssignment
): Promise<number> {
  const client = await ledgerPool.connect();
  try {
    const deadline = new Date(Date.now() + LEADER_WINDOW_MS);
    const res = await client.query(
      `INSERT INTO ledger.block_proposals
         (block_index, assigned_telegram_id, assigned_pubkey, tx_hashes, is_empty, deadline_at, status, prev_hash)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7)
       RETURNING id`,
      [blockIndex, leader.telegramId, leader.pubkeyHex, JSON.stringify(txHashes), isEmpty, deadline, prevHash]
    );
    const proposalId = res.rows[0].id;

    // Write-through cache: the assigned leader's daemon polls
    // /api/consensus/my-proposal every 2s (see block-producer-daemon.js) —
    // populating Redis here means that poll can be answered without
    // touching Postgres at all for the whole deadline window. TTL matches
    // the deadline plus a small margin so it naturally expires alongside it.
    await setCachedProposal(leader.telegramId, {
      proposalId, blockIndex, prevHash, txHashes, isEmpty,
      deadlineAt: deadline.toISOString(),
    }, Math.ceil(LEADER_WINDOW_MS / 1000) + 2);

    return proposalId;
  } finally {
    client.release();
  }
}

async function getProposalRow(proposalId: number): Promise<{
  assignedTelegramId: string;
  assignedPubkey: string;
  blockIndex: number;
  prevHash: string;
  txHashes: string[];
  status: string;
  deadlineAt: Date;
} | null> {
  const client = await ledgerPool.connect();
  try {
    const res = await client.query(
      `SELECT assigned_telegram_id, assigned_pubkey, block_index, prev_hash, tx_hashes, status, deadline_at
       FROM ledger.block_proposals WHERE id = $1`,
      [proposalId]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      assignedTelegramId: r.assigned_telegram_id,
      assignedPubkey: r.assigned_pubkey,
      blockIndex: r.block_index,
      prevHash: r.prev_hash,
      txHashes: Array.isArray(r.tx_hashes) ? r.tx_hashes : JSON.parse(r.tx_hashes || '[]'),
      status: r.status,
      deadlineAt: new Date(r.deadline_at),
    };
  } finally {
    client.release();
  }
}

async function getProposalStatus(proposalId: number): Promise<{ status: string; deadlineAt: Date } | null> {
  const client = await ledgerPool.connect();
  try {
    const res = await client.query(
      `SELECT status, deadline_at FROM ledger.block_proposals WHERE id = $1`,
      [proposalId]
    );
    if (res.rows.length === 0) return null;
    return { status: res.rows[0].status, deadlineAt: new Date(res.rows[0].deadline_at) };
  } finally {
    client.release();
  }
}

async function markProposalResolved(proposalId: number, resolution: 'submitted' | 'fallback_sealed', sealedBlockIndex: number) {
  const client = await ledgerPool.connect();
  try {
    await client.query(
      `UPDATE ledger.block_proposals
       SET status = $1, sealed_block_index = $2, resolved_at = NOW()
       WHERE id = $3`,
      [resolution, sealedBlockIndex, proposalId]
    );
  } finally {
    client.release();
  }
}

/**
 * Called from block-engine.ts before sealing. Returns either:
 *  - { mode: 'internal' } — caller should seal immediately, exactly as before.
 *  - { mode: 'leader', leader, proposalId, waitForAttestation } — caller
 *    should await waitForAttestation() which resolves to true (leader
 *    produced + Vercel verified a valid block in time) or false (deadline
 *    passed, or every submission attempt failed verification) — either
 *    way, false means seal as fallback, exactly as internal mode.
 */
export async function planBlockProduction(
  blockIndex: number,
  prevHash: string,
  txHashes: string[],
  isEmpty: boolean
): Promise<
  | { mode: 'internal' }
  | { mode: 'leader'; leader: LeaderAssignment; proposalId: number; waitForAttestation: () => Promise<boolean> }
> {
  const activeExternal = await getActiveExternalValidators();
  if (activeExternal.length < 2) {
    return { mode: 'internal' };
  }

  const leader = pickLeader(activeExternal, blockIndex);
  if (!leader) {
    // Enough "active" rows but none with a usable self-custody pubkey yet.
    return { mode: 'internal' };
  }

  const proposalId = await createProposal(blockIndex, prevHash, txHashes, isEmpty, leader);

  const waitForAttestation = async (): Promise<boolean> => {
    const deadline = Date.now() + LEADER_WINDOW_MS;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      const current = await getProposalStatus(proposalId);
      if (current?.status === 'submitted') return true;
    }
    return false; // timed out — caller falls back
  };

  return { mode: 'leader', leader, proposalId, waitForAttestation };
}

/** Called by the sealing caller once it knows the outcome, to close out the proposal row. */
export async function finalizeProposal(proposalId: number, attested: boolean, sealedBlockIndex: number) {
  await markProposalResolved(proposalId, attested ? 'submitted' : 'fallback_sealed', sealedBlockIndex);
}

/**
 * Fetches the current validated block hashes for an already-'submitted'
 * proposal, so block-engine.ts's sealBlock() can use the externally
 * computed values instead of inventing its own.
 */
export async function getValidatedProduction(proposalId: number): Promise<ValidatedProduction | null> {
  const client = await ledgerPool.connect();
  try {
    const res = await client.query(
      `SELECT submitted_block_hash, submitted_merkle_root, submitted_sequence_hash, submitted_timestamp_ms
       FROM ledger.block_proposals WHERE id = $1 AND status = 'submitted'`,
      [proposalId]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    if (!r.submitted_block_hash || !r.submitted_merkle_root || !r.submitted_sequence_hash || !r.submitted_timestamp_ms) {
      return null;
    }
    return {
      blockHash: r.submitted_block_hash,
      merkleRoot: r.submitted_merkle_root,
      sequenceHash: r.submitted_sequence_hash,
      timestampMs: Number(r.submitted_timestamp_ms),
    };
  } finally {
    client.release();
  }
}

/**
 * Called by GET /api/consensus/my-proposal — lets an external node poll
 * "is it my turn right now?" and fetch the exact template it needs to
 * compute the block (prevHash, blockIndex, txHashes, deadline).
 */
export async function getPendingProposalForValidator(telegramId: string): Promise<{
  proposalId: number;
  blockIndex: number;
  prevHash: string;
  txHashes: string[];
  isEmpty: boolean;
  deadlineAt: Date;
} | null> {
  const client = await ledgerPool.connect();
  try {
    const res = await client.query(
      `SELECT id, block_index, prev_hash, tx_hashes, is_empty, deadline_at
       FROM ledger.block_proposals
       WHERE assigned_telegram_id = $1 AND status = 'pending' AND deadline_at > NOW()
       ORDER BY id DESC LIMIT 1`,
      [telegramId]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      proposalId: r.id,
      blockIndex: r.block_index,
      prevHash: r.prev_hash,
      txHashes: Array.isArray(r.tx_hashes) ? r.tx_hashes : JSON.parse(r.tx_hashes || '[]'),
      isEmpty: r.is_empty,
      deadlineAt: new Date(r.deadline_at),
    };
  } finally {
    client.release();
  }
}

export type ProductionSubmission = {
  proposalId: number;
  telegramId: string;
  claimedPrevHash: string;
  merkleRoot: string;
  sequenceHash: string;
  blockHash: string;
  timestampMs: number;
  signature: string;
};

export type ProductionValidationResult =
  | { accepted: true }
  | { accepted: false; reason: string; status: number };

/**
 * Called by POST /api/consensus/submit-block. Recomputes every hash from
 * Vercel's own trusted inputs (never the client's claimed values) and
 * compares field-by-field against what the node submitted. Any mismatch
 * is a rejection with a specific, logged reason — this is the actual
 * fraud-detection surface: a node that didn't build on the real chain
 * tip, fabricated tx_hashes, or backdated its timestamp gets caught here
 * before anything is written to ledger.blocks.
 */
export async function validateAndAcceptProduction(
  submission: ProductionSubmission
): Promise<ProductionValidationResult> {
  const proposal = await getProposalRow(submission.proposalId);
  if (!proposal) return { accepted: false, reason: 'PROPOSAL_NOT_FOUND', status: 404 };
  if (proposal.assignedTelegramId !== submission.telegramId) {
    return { accepted: false, reason: 'NOT_THE_ASSIGNED_LEADER', status: 403 };
  }
  if (proposal.status !== 'pending') {
    return { accepted: false, reason: `PROPOSAL_ALREADY_${proposal.status.toUpperCase()}`, status: 409 };
  }
  if (Date.now() > proposal.deadlineAt.getTime()) {
    return { accepted: false, reason: 'DEADLINE_PASSED', status: 409 };
  }

  // 1. prevHash — catches a node building on a stale or fabricated tip.
  if (submission.claimedPrevHash !== proposal.prevHash) {
    await logRejection(submission.proposalId, 'PREV_HASH_MISMATCH');
    return { accepted: false, reason: 'PREV_HASH_MISMATCH', status: 422 };
  }

  // 2. timestamp bounds — catches backdating/future-dating.
  if (Math.abs(submission.timestampMs - Date.now()) > MAX_PRODUCTION_CLOCK_SKEW_MS) {
    await logRejection(submission.proposalId, 'TIMESTAMP_OUT_OF_RANGE');
    return { accepted: false, reason: 'TIMESTAMP_OUT_OF_RANGE', status: 422 };
  }

  // 3. Recompute merkleRoot from Vercel's OWN copy of tx_hashes — never
  // trust the client's claimed merkleRoot on its own.
  const recomputedMerkleRoot = computeMerkleRoot(proposal.txHashes);
  if (submission.merkleRoot !== recomputedMerkleRoot) {
    await logRejection(submission.proposalId, 'MERKLE_ROOT_MISMATCH');
    return { accepted: false, reason: 'MERKLE_ROOT_MISMATCH', status: 422 };
  }

  // 4. Recompute sequenceHash + blockHash from trusted prevHash/blockIndex
  // + the just-verified merkleRoot + the submitted (now bounds-checked) timestamp.
  const recomputedSequenceHash = computeSequenceHash(proposal.prevHash, proposal.blockIndex, submission.timestampMs);
  if (submission.sequenceHash !== recomputedSequenceHash) {
    await logRejection(submission.proposalId, 'SEQUENCE_HASH_MISMATCH');
    return { accepted: false, reason: 'SEQUENCE_HASH_MISMATCH', status: 422 };
  }

  const recomputedBlockHash = computeBlockHash(
    proposal.prevHash, proposal.blockIndex, recomputedMerkleRoot, submission.timestampMs, proposal.txHashes.length
  );
  if (submission.blockHash !== recomputedBlockHash) {
    await logRejection(submission.proposalId, 'BLOCK_HASH_MISMATCH');
    return { accepted: false, reason: 'BLOCK_HASH_MISMATCH', status: 422 };
  }

  // 5. Signature — proves the assigned validator's key actually produced
  // this exact (now-verified) blockHash, not just any string.
  const message = buildProductionMessage(submission.proposalId, proposal.blockIndex, recomputedBlockHash);
  const validSignature = await verifySignature(proposal.assignedPubkey, message, submission.signature);
  if (!validSignature) {
    await logRejection(submission.proposalId, 'INVALID_SIGNATURE');
    return { accepted: false, reason: 'INVALID_SIGNATURE', status: 401 };
  }

  // All checks passed — accept atomically (guards against a double-submit race).
  const client = await ledgerPool.connect();
  try {
    const res = await client.query(
      `UPDATE ledger.block_proposals
       SET status = 'submitted',
           submitted_block_hash = $1,
           submitted_merkle_root = $2,
           submitted_sequence_hash = $3,
           submitted_timestamp_ms = $4
       WHERE id = $5 AND status = 'pending'
       RETURNING id`,
      [recomputedBlockHash, recomputedMerkleRoot, recomputedSequenceHash, submission.timestampMs, submission.proposalId]
    );
    if (res.rows.length === 0) {
      return { accepted: false, reason: 'PROPOSAL_ALREADY_RESOLVED', status: 409 };
    }
    return { accepted: true };
  } finally {
    client.release();
  }
}

async function logRejection(proposalId: number, reason: string) {
  console.warn(`[EASTCHAIN] Block proposal #${proposalId} REJECTED: ${reason} — possible fraudulent/broken producer node.`);
  const client = await ledgerPool.connect();
  try {
    await client.query(
      `UPDATE ledger.block_proposals SET reject_reason = $1 WHERE id = $2 AND status = 'pending'`,
      [reason, proposalId]
    );
  } catch {
    // best-effort logging only — never let this mask the real rejection result
  } finally {
    client.release();
  }
}
