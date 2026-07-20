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
//
// CU note: at a 2s poll interval this is ~43,000 calls/day per running
// daemon — hitting Postgres on every single one is what actually burns
// through Neon's free-tier compute-hours (the DB never gets to
// autosuspend). Redis is checked FIRST via getCachedProposal(), which is
// populated the moment a proposal is created (see createProposal() in
// leader-schedule.ts) — a hit costs nothing against Neon. Only a genuine
// Redis outage (getCachedProposal returns null, not {pending:false}) falls
// back to the original Postgres query, so correctness never depends on
// the cache.
import { NextRequest, NextResponse } from 'next/server';
import { getPendingProposalForValidator } from '@/lib/consensus/leader-schedule';
import { checkProposalPollRateLimit, getCachedProposal } from '@/lib/db/redis';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const telegramId = searchParams.get('telegramId');
    if (!telegramId) {
      return NextResponse.json({ success: false, error: 'MISSING_TELEGRAM_ID' }, { status: 400 });
    }

    const rl = await checkProposalPollRateLimit(telegramId);
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, error: 'RATE_LIMITED' },
        { status: 429, headers: { 'Retry-After': String(rl.remainingSeconds ?? 5) } }
      );
    }

    const cached = await getCachedProposal(telegramId);
    if (cached !== null) {
      // Redis reachable — trust it either way, don't touch Postgres.
      if ('pending' in cached && cached.pending === false) {
        return NextResponse.json({ success: true, pending: false });
      }
      const p = cached as Exclude<typeof cached, { pending: false }>;
      return NextResponse.json({
        success: true,
        pending: true,
        proposalId: p.proposalId,
        blockIndex: p.blockIndex,
        prevHash: p.prevHash,
        txHashes: p.txHashes,
        isEmpty: p.isEmpty,
        deadlineAt: p.deadlineAt,
      });
    }

    // Redis unreachable — fall back to the original direct Postgres check.
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
