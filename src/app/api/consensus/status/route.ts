// GET /api/consensus/status — public monitoring endpoint
// Shows: active validators, heartbeat freshness, leader-proposal mode active?
import { NextRequest, NextResponse } from 'next/server';
import { getActiveExternalValidators, HEARTBEAT_FRESHNESS_SECONDS } from '@/lib/db/identity';
import { isLeaderProposalModeActive } from '@/lib/consensus/leader-schedule';

export const revalidate = 30; // Cache for 30 seconds

export async function GET(req: NextRequest) {
  try {
    const activeExternal = await getActiveExternalValidators();
    const leaderProposalActive = await isLeaderProposalModeActive();

    const now = Date.now();
    const heartbeatWindow = HEARTBEAT_FRESHNESS_SECONDS * 1000;

    const validators = activeExternal.map(v => ({
      telegramId: v.telegramId,
      score: v.totalScore,
      // Note: we don't expose pubkey or heartbeat timestamp for privacy
      // Admin can use /api/admin endpoints if they need details
    }));

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      consensus: {
        mode: leaderProposalActive ? 'leader-proposal' : 'internal',
        activeExternalValidators: activeExternal.length,
        requiredForLeaderProposal: 1,
        leaderProposalActive,
      },
      validators,
      heartbeatFreshness: `${HEARTBEAT_FRESHNESS_SECONDS}s`,
      info: leaderProposalActive
        ? 'Leader-proposal mode ACTIVE: external validator nodes are participating in block proposal.'
        : 'Leader-proposal mode INACTIVE: Vercel self-producing blocks (internal mode).',
    });
  } catch (err: any) {
    console.error('[EASTCHAIN] consensus/status error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
