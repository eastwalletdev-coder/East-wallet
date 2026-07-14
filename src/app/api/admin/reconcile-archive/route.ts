/**
 * POST /api/admin/reconcile-archive — Ledger ↔ R2 archive check.
 *
 * The rolling sweep already runs automatically — it's wired into
 * /api/epoch (see that file), piggybacking on the existing 24h QStash
 * trigger instead of needing a schedule of its own. This endpoint is for:
 *
 *  - Manual full audit: POST { "fromHeight": X, "toHeight": Y } to check
 *    any specific range on demand. Does NOT move the rolling watermark,
 *    so it's safe to re-run over the same range repeatedly for spot-checks
 *    without disturbing the automatic sweep.
 *  - Forcing an extra rolling pass on demand: POST with no body (or a body
 *    without fromHeight/toHeight) runs the same rolling step /api/epoch
 *    does, in case you don't want to wait for the next epoch.
 *
 * Auth: same as /api/epoch — x-cron-secret header matching ADMIN_SECRET,
 * or a verified QStash signature (kept in case you ever do want a
 * dedicated, more-frequent schedule for this later).
 */
import { NextRequest, NextResponse } from 'next/server';
import { ledgerPool } from '@/lib/db/ledger';
import { reconcileRange, checkOrphanedArchiveTip, runRollingReconciliation } from '@/lib/archive/reconcile';
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

  let body: any = {};
  try { body = rawBody ? JSON.parse(rawBody) : {}; } catch { /* empty body — fine */ }

  const isManualRange = Number.isFinite(body.fromHeight) && Number.isFinite(body.toHeight);

  if (isManualRange) {
    const { checked, discrepancies } = await reconcileRange(body.fromHeight, body.toHeight);
    const orphanCheck = await checkOrphanedArchiveTip();
    return NextResponse.json({
      success: true,
      mode: 'manual',
      range: { fromHeight: body.fromHeight, toHeight: body.toHeight },
      checked,
      discrepancies,
      orphanedArchiveTip: orphanCheck.anomaly ? orphanCheck : null,
    });
  }

  const result = await runRollingReconciliation();
  if (!result.range) {
    return NextResponse.json({ success: true, mode: 'rolling', checked: 0, discrepancies: [], message: 'Nothing new to reconcile' });
  }
  return NextResponse.json({ success: true, mode: 'rolling', ...result });
}

// Quick status peek — how far the rolling sweep has gotten, and the most
// recent discrepancies found (healed or not).
export async function GET() {
  const client = await ledgerPool.connect();
  try {
    const wmRes = await client.query("SELECT value FROM ledger.chain_meta WHERE key = 'last_reconciled_height'");
    const recentRes = await client.query(
      'SELECT * FROM ledger.archive_discrepancies ORDER BY detected_at DESC LIMIT 20'
    );
    return NextResponse.json({
      lastReconciledHeight: wmRes.rows.length > 0 ? parseInt(wmRes.rows[0].value) : null,
      recentDiscrepancies: recentRes.rows,
    });
  } finally {
    client.release();
  }
}
