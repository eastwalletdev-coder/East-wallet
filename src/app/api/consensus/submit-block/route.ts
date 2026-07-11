// POST /api/consensus/submit-block
//
// SCOPE NOTE: the live transaction path (sendEast/stakeEast/claimMining,
// see mining-actions.ts + contracts/*.ts) uses direct-seal (1 tx = 1 block
// immediately, inside an open DB transaction) and is credited via the
// non-blocking resolveBlockProducer() rotation — it does NOT wait for an
// external node to call this endpoint, because holding a DB transaction
// open for a live handshake would freeze the user's request.
//
// This endpoint is for the OTHER path: block-engine.ts's batch mempool +
// empty-block scheduler. The node assigned as leader (see GET
// /api/consensus/my-proposal) actually COMPUTES the block itself
// (merkleRoot, sequenceHash, blockHash from prevHash + the tx_hashes it
// was given) and submits the result here. Vercel independently
// recomputes every value from ITS OWN trusted copy of prevHash/tx_hashes
// and only accepts if everything matches exactly — see
// leader-schedule.ts's validateAndAcceptProduction() for the full check
// list (prevHash, merkleRoot, sequenceHash, blockHash, timestamp bounds,
// signature). Any mismatch is rejected with a specific reason and
// logged; the slot then falls back to Vercel self-producing so the
// chain never stalls on a broken or dishonest node.
import { NextRequest, NextResponse } from 'next/server';
import { validateAndAcceptProduction } from '@/lib/consensus/leader-schedule';

export async function POST(req: NextRequest) {
  try {
    const {
      proposalId,
      telegramId,
      prevHash,
      merkleRoot,
      sequenceHash,
      blockHash,
      timestampMs,
      signature,
    } = await req.json();

    if (
      !proposalId || !telegramId || !prevHash || !merkleRoot ||
      !sequenceHash || !blockHash || !timestampMs || !signature
    ) {
      return NextResponse.json({ success: false, error: 'MISSING_FIELDS' }, { status: 400 });
    }

    const result = await validateAndAcceptProduction({
      proposalId: Number(proposalId),
      telegramId: String(telegramId),
      claimedPrevHash: String(prevHash),
      merkleRoot: String(merkleRoot),
      sequenceHash: String(sequenceHash),
      blockHash: String(blockHash),
      timestampMs: Number(timestampMs),
      signature: String(signature),
    });

    if (!result.accepted) {
      return NextResponse.json({ success: false, error: result.reason }, { status: result.status });
    }
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[EASTCHAIN] submit-block error:', err);
    return NextResponse.json({ success: false, error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
