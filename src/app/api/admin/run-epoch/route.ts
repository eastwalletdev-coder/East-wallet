// POST /api/admin/run-epoch — Manually trigger PoC epoch scoring
// Recomputes validator scores from current staking data and activates top N (see TOP_VALIDATORS in poc-engine.ts).
// Admin-only (no QStash path) since this isn't meant to run on a public schedule.
import { NextRequest, NextResponse } from 'next/server';
import { identityPool } from '@/lib/db/identity';
import { runEpoch } from '@/lib/poc-engine';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  const isAdmin = secret === process.env.ADMIN_SECRET;

  if (process.env.NODE_ENV === 'production' && !isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await runEpoch();

    const client = await identityPool.connect();
    let validators: any[] = [];
    try {
      const res = await client.query(
        `SELECT telegram_id, wallet_address, stake_score, uptime_score, reputation_score, total_score, epoch_updated_at
         FROM identity.validators
         WHERE is_active = TRUE
         ORDER BY total_score DESC`
      );
      validators = res.rows;
    } finally {
      client.release();
    }

    return NextResponse.json({
      success: true,
      activeValidatorCount: validators.length,
      validators,
    });
  } catch (err: any) {
    console.error('[EASTCHAIN] Manual epoch trigger error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
