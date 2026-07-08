/**
 * EASTCHAIN — Leader schedule / block proposals
 * ─────────────────────────────────────────────────────────────────────
 * HONEST SCOPE — read this before wiring it in further:
 * Vercel still assembles every block, computes its hash/merkle root, and
 * writes it to ledger.blocks — that part is NOT decentralized here. What
 * this module changes is WHO gets credited/authorized as a block's
 * producer once there are enough real external validator nodes running:
 *
 *   < 2 active external nodes  → Vercel self-produces, exactly like today
 *                                 (block-engine.ts's existing behavior).
 *   >= 2 active external nodes → Vercel picks a leader deterministically,
 *                                 opens a short window for that node to
 *                                 counter-sign ("attest") the proposal,
 *                                 and credits them as validator_id if they
 *                                 do. If the deadline passes unclaimed,
 *                                 Vercel falls back to self-producing that
 *                                 slot — the chain must never stall on one
 *                                 offline node (this fallback behavior was
 *                                 a deliberate choice, not a default).
 *
 * "Active external node" = identity.validators row with node_type='external'
 * AND a heartbeat inside HEARTBEAT_FRESHNESS_SECONDS AND a registered
 * self-custody pubkey. See identity.ts for the underlying columns/queries.
 *
 * Cross-request coordination note: because sealing a block needs the
 * in-memory PendingTx closures (commitFn/rollbackFn) that only exist in
 * the Vercel function instance that received those transactions, the
 * external node's /api/consensus/submit-block call does NOT seal the
 * block itself — it just marks the proposal 'submitted' in the DB. The
 * ORIGINAL instance (already polling, see attemptSealOrPropose below)
 * is the one that notices this and performs the actual seal, crediting
 * the leader. This mirrors the existing in-memory mempool's own
 * same-warm-instance assumption — a known limitation of this
 * architecture at small scale, not something newly introduced here.
 */

import { ledgerPool } from '@/lib/db/ledger';
import { getActiveExternalValidators } from '@/lib/db/identity';

export const LEADER_WINDOW_MS = 15_000; // how long a leader has to attest
const POLL_INTERVAL_MS = 2_000;

export type LeaderAssignment = {
  telegramId: string;
  pubkeyHex: string;
};

/**
 * Deterministic round-robin: same block index always picks the same
 * leader given the same active-validator set, so any node could recompute
 * this independently rather than trusting Vercel's word for it (they still
 * have to trust the mempool contents/hash for now — see file header).
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

export function buildAttestationMessage(proposalId: number, blockIndex: number): string {
  return `BLOCK_ATTEST|${proposalId}|${blockIndex}`;
}

/**
 * Lightweight, NON-blocking producer resolution for the real, live
 * direct-seal path (mining-actions.ts and the 3 contract files each have
 * their own inline sealSingleTx — see block-engine.ts's header comment
 * for why the mempool/proposal/attestation machinery above does NOT sit
 * on that path). Every real tx seals its own block immediately, inside
 * an already-open DB transaction — a 15s attestation wait there would
 * freeze the user's request and risk exhausting the connection pool.
 *
 * So for this path there is no live handshake: if 2+ external nodes are
 * verified live (heartbeat), Vercel deterministically credits one of them
 * as validator_id via the same round-robin as pickLeader(), with zero
 * added latency beyond one indexed query. Below 2 active nodes, returns
 * null and the caller falls back to the existing getActiveValidator()
 * (top PoC score) behavior — unchanged from before.
 */
export async function resolveBlockProducer(blockIndex: number): Promise<string | null> {
  const activeExternal = await getActiveExternalValidators();
  if (activeExternal.length < 2) return null;
  const leader = pickLeader(activeExternal, blockIndex);
  return leader?.telegramId ?? null;
}

async function createProposal(
  blockIndex: number,
  txHashes: string[],
  isEmpty: boolean,
  leader: LeaderAssignment
): Promise<number> {
  const client = await ledgerPool.connect();
  try {
    const deadline = new Date(Date.now() + LEADER_WINDOW_MS);
    const res = await client.query(
      `INSERT INTO ledger.block_proposals
         (block_index, assigned_telegram_id, assigned_pubkey, tx_hashes, is_empty, deadline_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       RETURNING id`,
      [blockIndex, leader.telegramId, leader.pubkeyHex, JSON.stringify(txHashes), isEmpty, deadline]
    );
    return res.rows[0].id;
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
 *    attested in time — seal crediting them) or false (deadline passed —
 *    seal as fallback, exactly as internal mode).
 */
export async function planBlockProduction(
  blockIndex: number,
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

  const proposalId = await createProposal(blockIndex, txHashes, isEmpty, leader);

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
 * Called by /api/consensus/submit-block AFTER it has already verified the
 * signature and confirmed telegramId matches the proposal's assigned
 * leader. Does not seal anything — see file header for why.
 */
export async function attestProposal(proposalId: number): Promise<{ success: boolean; error?: string }> {
  const current = await getProposalStatus(proposalId);
  if (!current) return { success: false, error: 'PROPOSAL_NOT_FOUND' };
  if (current.status !== 'pending') return { success: false, error: `PROPOSAL_ALREADY_${current.status.toUpperCase()}` };
  if (Date.now() > current.deadlineAt.getTime()) return { success: false, error: 'DEADLINE_PASSED' };

  const client = await ledgerPool.connect();
  try {
    await client.query(
      `UPDATE ledger.block_proposals SET status = 'submitted' WHERE id = $1 AND status = 'pending'`,
      [proposalId]
    );
    return { success: true };
  } finally {
    client.release();
  }
}

export async function getProposalForAttestation(proposalId: number): Promise<{
  assignedTelegramId: string;
  assignedPubkey: string;
  blockIndex: number;
  status: string;
  deadlineAt: Date;
} | null> {
  const client = await ledgerPool.connect();
  try {
    const res = await client.query(
      `SELECT assigned_telegram_id, assigned_pubkey, block_index, status, deadline_at
       FROM ledger.block_proposals WHERE id = $1`,
      [proposalId]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      assignedTelegramId: r.assigned_telegram_id,
      assignedPubkey: r.assigned_pubkey,
      blockIndex: r.block_index,
      status: r.status,
      deadlineAt: new Date(r.deadline_at),
    };
  } finally {
    client.release();
  }
}
