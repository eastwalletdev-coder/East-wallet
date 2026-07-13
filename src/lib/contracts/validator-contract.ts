/**
 * EASTCHAIN — Validator Contract (address: CONTRACTS.VALIDATOR)
 * Recovery-consensus voting. Caller must be an active validator.
 * No token movement here (governance action), but it still goes through
 * the engine so it's gas-metered and recorded like every other call.
 */
import { setNetworkStatus } from '@/lib/db/redis';
import { notifyRecoverySuccess } from '@/lib/gossip';
import { computeRequiredQuorum } from '@/lib/consensus/quorum';

export async function execute(
  functionName: string,
  params: Record<string, any>,
  ctx: { tgId: string; user: any; identityClient: any; ledgerClient: any }
): Promise<{ success: boolean; error?: string; data?: any }> {
  const { tgId, identityClient } = ctx;
  if (functionName !== 'vote') return { success: false, error: 'UNIMPLEMENTED_FUNCTION' };

  const vote = params.vote;
  const roundId = String(params.roundId || new Date().toISOString().substring(0, 10));
  if (vote !== 'approve' && vote !== 'reject') return { success: false, error: 'INVALID_VOTE' };

  const validatorRes = await identityClient.query(
    'SELECT telegram_id FROM identity.validators WHERE telegram_id = $1 AND is_active = TRUE',
    [tgId]
  );
  if (!validatorRes.rows.length) return { success: false, error: 'NOT_A_VALIDATOR' };

  await identityClient.query(`
    INSERT INTO identity.consensus_votes (round_id, voter_id, vote)
    VALUES ($1, $2, $3)
    ON CONFLICT (round_id, voter_id) DO UPDATE SET vote = $3, created_at = NOW()
  `, [roundId, tgId, vote]);

  const votesRes = await identityClient.query(`
    SELECT COUNT(*) as approve_count FROM identity.consensus_votes
    WHERE round_id = $1 AND vote = 'approve'
  `, [roundId]);
  const approveCount = Number(votesRes.rows[0]?.approve_count || 0);

  const validatorsRes = await identityClient.query(
    'SELECT COUNT(*) as total FROM identity.validators WHERE is_active = TRUE'
  );
  const totalValidators = Number(validatorsRes.rows[0]?.total || 0);
  const QUORUM = computeRequiredQuorum(totalValidators);

  let quorumReached = false;
  if (approveCount >= QUORUM) {
    quorumReached = true;
    await setNetworkStatus('active');
    await notifyRecoverySuccess(approveCount, totalValidators);
  }

  return {
    success: true,
    data: { roundId, approveCount, quorumNeeded: QUORUM, totalValidators, quorumReached },
  };
}
