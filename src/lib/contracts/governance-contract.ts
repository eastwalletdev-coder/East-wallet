/**
 * EASTCHAIN — Governance Contract (address: CONTRACTS.GOVERNANCE)
 * ─────────────────────────────────────────────────────────────────────
 * Gate for adding NEW contract functions. A function's handler code can
 * already exist in e.g. staking-contract.ts, but registry.ts's
 * isKnownCall() rejects it as UNKNOWN_CONTRACT_FUNCTION — same error as a
 * function that doesn't exist at all — until a quorum of active
 * validators approves it here. This is a strict allow-list extension:
 * approval only ever ADDS an entry to identity.approved_contract_functions,
 * never changes what an already-whitelisted function can do.
 *
 * proposeFunction — founder or any active validator can propose.
 * voteOnProposal  — active validators only. Reuses computeRequiredQuorum(),
 *                   same simple-majority-of-active-validators rule as the
 *                   recovery vote in validator-contract.ts, recomputed
 *                   fresh on every vote so it can't go stale as the
 *                   validator set changes size.
 *
 * No token movement here (governance action) — still goes through the
 * engine so it's signed, nonce-protected, and gas-metered like every
 * other call.
 */
import { computeRequiredQuorum } from '@/lib/consensus/quorum';
import { CONTRACTS, CONTRACT_ABI } from './registry';

const FOUNDER_IDS = (process.env.FOUNDER_IDS || '').split(',').map((id) => id.trim()).filter(Boolean);

async function isActiveValidator(identityClient: any, tgId: string): Promise<boolean> {
  const res = await identityClient.query(
    'SELECT 1 FROM identity.validators WHERE telegram_id = $1 AND is_active = TRUE',
    [tgId]
  );
  return res.rows.length > 0;
}

async function isAlreadyKnown(identityClient: any, contractAddress: string, functionName: string): Promise<boolean> {
  const abi = CONTRACT_ABI[contractAddress];
  if (abi && functionName in abi) return true;
  const res = await identityClient.query(
    'SELECT 1 FROM identity.approved_contract_functions WHERE contract_address = $1 AND function_name = $2',
    [contractAddress, functionName]
  );
  return res.rows.length > 0;
}

export async function execute(
  functionName: string,
  params: Record<string, any>,
  ctx: { tgId: string; user: any; identityClient: any; ledgerClient: any }
): Promise<{ success: boolean; error?: string; data?: any }> {
  const { tgId, identityClient } = ctx;

  if (functionName === 'proposeFunction') {
    const targetContract = String(params.contractAddress || '');
    const targetFunction = String(params.functionName || '');
    const paramKeys = params.paramKeys;

    const isFounder = FOUNDER_IDS.includes(tgId);
    if (!isFounder && !(await isActiveValidator(identityClient, tgId))) {
      return { success: false, error: 'NOT_AUTHORIZED' };
    }
    if (!Object.values(CONTRACTS).includes(targetContract as any)) {
      return { success: false, error: 'UNKNOWN_TARGET_CONTRACT' };
    }
    if (!targetFunction) return { success: false, error: 'INVALID_FUNCTION_NAME' };
    if (!Array.isArray(paramKeys) || !paramKeys.every((k) => typeof k === 'string')) {
      return { success: false, error: 'INVALID_PARAM_KEYS' };
    }
    if (await isAlreadyKnown(identityClient, targetContract, targetFunction)) {
      return { success: false, error: 'ALREADY_APPROVED' };
    }

    const totalRes = await identityClient.query(
      'SELECT COUNT(*)::int AS c FROM identity.validators WHERE is_active = TRUE'
    );
    const quorumRequired = computeRequiredQuorum(Number(totalRes.rows[0].c));

    try {
      const ins = await identityClient.query(
        `INSERT INTO identity.contract_proposals
           (contract_address, function_name, param_keys, proposed_by, quorum_required)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [targetContract, targetFunction, JSON.stringify(paramKeys), tgId, quorumRequired]
      );
      return { success: true, data: { proposalId: ins.rows[0].id, quorumRequired } };
    } catch (err: any) {
      // Partial unique index (contract_address, function_name) WHERE status='pending'
      if (String(err.message || '').includes('idx_contract_proposals_pending_unique')) {
        return { success: false, error: 'PROPOSAL_ALREADY_PENDING' };
      }
      throw err;
    }
  }

  if (functionName === 'voteOnProposal') {
    const proposalId = Number(params.proposalId);
    const vote = params.vote;
    if (!Number.isInteger(proposalId)) return { success: false, error: 'INVALID_PROPOSAL_ID' };
    if (vote !== 'approve' && vote !== 'reject') return { success: false, error: 'INVALID_VOTE' };
    if (!(await isActiveValidator(identityClient, tgId))) return { success: false, error: 'NOT_A_VALIDATOR' };

    const propRes = await identityClient.query(
      'SELECT * FROM identity.contract_proposals WHERE id = $1 FOR UPDATE',
      [proposalId]
    );
    if (!propRes.rows.length) return { success: false, error: 'PROPOSAL_NOT_FOUND' };
    const proposal = propRes.rows[0];
    if (proposal.status !== 'pending') {
      return { success: false, error: `PROPOSAL_ALREADY_${String(proposal.status).toUpperCase()}` };
    }

    await identityClient.query(
      `INSERT INTO identity.contract_proposal_votes (proposal_id, voter_id, vote)
       VALUES ($1, $2, $3)
       ON CONFLICT (proposal_id, voter_id) DO UPDATE SET vote = $3, created_at = NOW()`,
      [proposalId, tgId, vote]
    );

    const countRes = await identityClient.query(
      `SELECT vote, COUNT(*)::int AS c FROM identity.contract_proposal_votes
       WHERE proposal_id = $1 GROUP BY vote`,
      [proposalId]
    );
    const approveCount = Number(countRes.rows.find((r: any) => r.vote === 'approve')?.c || 0);
    const rejectCount = Number(countRes.rows.find((r: any) => r.vote === 'reject')?.c || 0);
    const quorum = Number(proposal.quorum_required);

    let newStatus: 'pending' | 'approved' | 'rejected' = 'pending';
    if (approveCount >= quorum) newStatus = 'approved';
    else if (rejectCount >= quorum) newStatus = 'rejected';

    if (newStatus !== 'pending') {
      await identityClient.query(
        'UPDATE identity.contract_proposals SET status = $1, decided_at = NOW() WHERE id = $2',
        [newStatus, proposalId]
      );
      if (newStatus === 'approved') {
        await identityClient.query(
          `INSERT INTO identity.approved_contract_functions (contract_address, function_name, param_keys)
           VALUES ($1, $2, $3)
           ON CONFLICT (contract_address, function_name) DO NOTHING`,
          [proposal.contract_address, proposal.function_name, proposal.param_keys]
        );
      }
    }

    return { success: true, data: { proposalId, approveCount, rejectCount, quorum, status: newStatus } };
  }

  return { success: false, error: 'UNIMPLEMENTED_FUNCTION' };
}
