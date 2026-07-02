/**
 * POST /api/epoch — Trigger PoC epoch manually or via Vercel cron
 * Add to vercel.json crons: { "path": "/api/epoch", "schedule": "0 0 * * *" }
 */
import { NextRequest, NextResponse } from 'next/server';
import { runEpoch, getTopValidators } from '@/lib/poc-engine';
import { notifyNewEpoch } from '@/lib/gossip';
import { ledgerPool } from '@/lib/db/ledger';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  const isAdmin = secret === process.env.ADMIN_SECRET;
  const isQStash = req.headers.get('upstash-signature') !== null
    && process.env.QSTASH_CURRENT_SIGNING_KEY !== undefined;

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

    return NextResponse.json({
      success: true,
      epoch: epochCount,
      validators: validators.length,
    });
  } finally {
    client.release();
  }
}

export async function GET() {
  const validators = await getTopValidators();
  return NextResponse.json({ validators });
}
