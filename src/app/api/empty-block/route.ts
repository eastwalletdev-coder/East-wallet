// POST /api/empty-block — Seal empty block (triggered by QStash every 30 min)
//
// FIXED: this used to have its OWN inline block-sealing SQL, completely
// bypassing block-engine.ts's sealBlock() — which meant empty blocks
// sealed here never got a chain signature (chain-signing.ts). Now routes
// through the same attemptSealOrPropose()/sealBlock() every other block
// goes through, so signing + leader-proposal handling all apply uniformly.
import { NextRequest, NextResponse } from 'next/server';
import { identityPool } from '@/lib/db/identity';
import { attemptSealOrPropose } from '@/lib/block-engine';
import { getNetworkStatus } from '@/lib/db/redis';
import { Receiver } from '@upstash/qstash';

async function verifyQStashSignature(req: NextRequest, rawBody: string): Promise<boolean> {
  const signature = req.headers.get('upstash-signature');
  const currentKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextKey = process.env.QSTASH_NEXT_SIGNING_KEY;

  if (!signature || !currentKey) return false;

  try {
    const receiver = new Receiver({
      currentSigningKey: currentKey,
      nextSigningKey: nextKey || currentKey,
    });
    return await receiver.verify({ signature, body: rawBody });
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  const secret = req.headers.get('x-cron-secret');
  const isAdmin = secret === process.env.ADMIN_SECRET;
  const isQStash = await verifyQStashSignature(req, rawBody);

  if (process.env.NODE_ENV === 'production' && !isAdmin && !isQStash) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const status = await getNetworkStatus();
  if (status === 'halted') {
    return NextResponse.json({ skipped: true, reason: 'NETWORK_HALTED' });
  }

  const identityClient = await identityPool.connect();
  try {
    const validatorRes = await identityClient.query(
      'SELECT telegram_id FROM identity.validators WHERE is_active = TRUE ORDER BY total_score DESC LIMIT 1'
    );
    if (!validatorRes.rows.length) {
      return NextResponse.json({ skipped: true, reason: 'NO_ACTIVE_VALIDATOR' });
    }

    const result = await attemptSealOrPropose([], true);
    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 500 });
    }

    console.log(`[EASTCHAIN] Empty block #${result.blockIndex} sealed (signed + archived to R2)`);
    return NextResponse.json({
      success: true,
      blockIndex: result.blockIndex,
      blockHash: result.blockHash,
      sequenceHash: result.sequenceHash,
    });
  } catch (err: any) {
    console.error('[EASTCHAIN] Empty block error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  } finally {
    identityClient.release();
  }
}
