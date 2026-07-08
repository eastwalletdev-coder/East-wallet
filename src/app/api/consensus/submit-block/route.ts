// POST /api/consensus/submit-block
//
// SCOPE NOTE: the live transaction path (sendEast/stakeEast/claimMining,
// see mining-actions.ts + contracts/*.ts) uses direct-seal (1 tx = 1 block
// immediately, inside an open DB transaction) and is credited via the
// non-blocking resolveBlockProducer() rotation — it does NOT wait for an
// external node to call this endpoint, because holding a DB transaction
// open for a live handshake would freeze the user's request.
//
// This endpoint exists for the OTHER path: block-engine.ts's batch
// mempool + empty-block scheduler, which — if ever wired into real
// traffic — opens a short attestation window per proposal (see
// leader-schedule.ts's planBlockProduction/attemptSealOrPropose). An
// external node calls this to counter-sign that window before it expires.
// It does not seal anything itself; it only marks the proposal as
// attested so the waiting instance can credit that node when it seals.
import { NextRequest, NextResponse } from 'next/server';
import { verifySignature } from '@/lib/keypair-service';
import {
  getProposalForAttestation,
  attestProposal,
  buildAttestationMessage,
} from '@/lib/consensus/leader-schedule';

export async function POST(req: NextRequest) {
  try {
    const { proposalId, telegramId, signature } = await req.json();
    if (!proposalId || !telegramId || !signature) {
      return NextResponse.json({ success: false, error: 'MISSING_FIELDS' }, { status: 400 });
    }

    const proposal = await getProposalForAttestation(Number(proposalId));
    if (!proposal) {
      return NextResponse.json({ success: false, error: 'PROPOSAL_NOT_FOUND' }, { status: 404 });
    }
    if (proposal.assignedTelegramId !== telegramId) {
      return NextResponse.json({ success: false, error: 'NOT_THE_ASSIGNED_LEADER' }, { status: 403 });
    }
    if (Date.now() > proposal.deadlineAt.getTime()) {
      return NextResponse.json({ success: false, error: 'DEADLINE_PASSED' }, { status: 409 });
    }

    const message = buildAttestationMessage(Number(proposalId), proposal.blockIndex);
    const validSignature = await verifySignature(proposal.assignedPubkey, message, signature);
    if (!validSignature) {
      return NextResponse.json({ success: false, error: 'INVALID_SIGNATURE' }, { status: 401 });
    }

    const result = await attestProposal(Number(proposalId));
    return NextResponse.json(result, { status: result.success ? 200 : 409 });
  } catch (err: any) {
    console.error('[EASTCHAIN] submit-block error:', err);
    return NextResponse.json({ success: false, error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
