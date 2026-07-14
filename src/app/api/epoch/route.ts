/**
 * POST /api/epoch — Trigger PoC epoch manually or via Vercel cron
 * Add to vercel.json crons: { "path": "/api/epoch", "schedule": "0 0 * * *" }
 */
import { NextRequest, NextResponse } from 'next/server';
import { runEpoch, getTopValidators } from '@/lib/poc-engine';
import { notifyNewEpoch } from '@/lib/gossip';
import { ledgerPool } from '@/lib/db/ledger';
import { runRollingReconciliation } from '@/lib/archive/reconcile';
import { Receiver } from '@upstash/qstash';

// Same verification pattern as /api/empty-block — actually checks the QStash
// signature instead of just checking whether the header is present.
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

  await runEpoch();

  const validators = await getTopValidators();

  // Get epoch number from chain_meta
  const client = await ledgerPool.connect();
  try {
    const epochRes = await client.query(
      "SELECT value FROM ledger.chain_meta WHERE key = 'epoch_count'"
    );
    const epochCount = epochRes.rows.length > 0
      ? parseInt(epochRes.rows[0].value) + 1
      : 1;

    await client.query(`
      INSERT INTO ledger.chain_meta (key, value)
      VALUES ('epoch_count', $1)
      ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()
    `, [String(epochCount)]);

    // Gossip epoch result to validators
    await notifyNewEpoch(epochCount, validators.length);

    // Ledger↔R2 archive reconciliation — piggybacks on this existing 24h
    // trigger instead of needing its own QStash schedule. Never let a
    // reconciliation problem take down the epoch response itself; the
    // rolling watermark just picks up where it left off next time.
    let reconciliation = null;
    try {
      reconciliation = await runRollingReconciliation();
      if (reconciliation.discrepancies.length > 0) {
        console.warn(
          `[EASTCHAIN] Epoch ${epochCount}: reconciliation found ${reconciliation.discrepancies.length} discrepancy(ies) in range`,
          reconciliation.range
        );
      }
    } catch (err) {
      console.error('[EASTCHAIN] Epoch reconciliation error (non-fatal):', err);
    }

    return NextResponse.json({
      success: true,
      epoch: epochCount,
      validators: validators.length,
      reconciliation,
    });
  } finally {
    client.release();
  }
}

export async function GET() {
  const validators = await getTopValidators();
  return NextResponse.json({ validators });
}
