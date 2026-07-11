// GET /api/consensus/my-proposal?telegramId=X
//
// Polled by an external validator's own producer daemon (see
// scripts/block-producer-daemon.js) every couple of seconds. Returns the
// pending block template if — and only if — this telegramId is currently
// the assigned leader for a 'pending' proposal within its deadline.
//
// The node uses prevHash + txHashes from this response to compute
// merkleRoot/sequenceHash/blockHash locally (see block-math.ts — the
// algorithm is mirrored exactly in the daemon script), then submits the
// result to POST /api/consensus/submit-block for verification.
import { NextRequest, NextResponse } from 'next/server';
import { getPendingProposalForValidator } from '@/lib/consensus/leader-schedule';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const telegramId = searchParams.get('telegramId');
    if (!telegramId) {
      return NextResponse.json({ success: false, error: 'MISSING_TELEGRAM_ID' }, { status: 400 });
    }

    const proposal = await getPendingProposalForValidator(telegramId);
    if (!proposal) {
      return NextResponse.json({ success: true, pending: false });
    }

    return NextResponse.json({
      success: true,
      pending: true,
      proposalId: proposal.proposalId,
      blockIndex: proposal.blockIndex,
      prevHash: proposal.prevHash,
      txHashes: proposal.txHashes,
      isEmpty: proposal.isEmpty,
      deadlineAt: proposal.deadlineAt.toISOString(),
    });
  } catch (err: any) {
    console.error('[EASTCHAIN] my-proposal error:', err);
    return NextResponse.json({ success: false, error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
