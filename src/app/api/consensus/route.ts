/**
 * POST /api/consensus — Submit validator recovery vote
 * GET  /api/consensus — Check current vote status
 */
import { NextRequest, NextResponse } from 'next/server';
import { identityPool } from '@/lib/db/identity';
import { getNetworkStatus } from '@/lib/db/redis';
import { voteValidatorContract } from '@/actions/contract-actions';

const QUORUM = 7;

export async function GET() {
  const client = await identityPool.connect();
  try {
    const networkStatus = await getNetworkStatus();

    // Get current round votes
    const votesRes = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE vote = 'approve') as approve_count,
        COUNT(*) FILTER (WHERE vote = 'reject') as reject_count,
        COUNT(*) as total_votes
      FROM identity.consensus_votes
      WHERE created_at > NOW() - INTERVAL '24 hours'
    `);

    const validatorsRes = await client.query(`
      SELECT COUNT(*) as active_count
      FROM identity.validators
      WHERE is_active = TRUE
    `);

    return NextResponse.json({
      networkStatus,
      votes: {
        approve: Number(votesRes.rows[0]?.approve_count || 0),
        reject: Number(votesRes.rows[0]?.reject_count || 0),
        total: Number(votesRes.rows[0]?.total_votes || 0),
      },
      activeValidators: Number(validatorsRes.rows[0]?.active_count || 0),
      quorumNeeded: QUORUM,
    });
  } finally {
    client.release();
  }
}

export async function POST(req: NextRequest) {
  const { telegramId, vote, initData } = await req.json();

  if (!telegramId || !vote) {
    return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
  }
  if (vote !== 'approve' && vote !== 'reject') {
    return NextResponse.json({ error: 'INVALID_VOTE' }, { status: 400 });
  }

  // Vote now runs through lib/contracts/engine.ts (CONTRACTS.VALIDATOR/vote):
  // Telegram initData is re-verified inside the engine, the call is
  // gas-metered in EAST, signed + nonce-protected, and recorded in
  // ledger.contract_calls. Business rules (must be an active validator,
  // quorum check, network restore) live in lib/contracts/validator-contract.ts.
  const roundId = new Date().toISOString().substring(0, 10); // date as round ID
  const result = await voteValidatorContract(telegramId, roundId, vote, initData);

  if (!result.success) {
    const status = result.error === 'NOT_A_VALIDATOR' ? 403
      : result.error === 'IDENTITY_VIOLATION' || result.error === 'IDENTITY_MISMATCH' ? 401
      : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  if (result.quorumReached) {
    return NextResponse.json({
      success: true,
      quorumReached: true,
      message: `Network restored — ${result.approveCount}/${result.totalValidators} validators approved`,
    });
  }

  return NextResponse.json({
    success: true,
    quorumReached: false,
    approveCount: result.approveCount,
    quorumNeeded: result.quorumNeeded,
    remaining: result.quorumNeeded - result.approveCount,
  });
}
