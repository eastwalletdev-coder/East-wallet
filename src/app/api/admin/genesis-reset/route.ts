// POST /api/admin/genesis-reset
//
// Wipes all chain data (blocks/tx/mempool/stakes/mint counters) to zero
// and restores every user's balance via real on-chain GENESIS_RESTORE
// transactions — see src/actions/genesis-reset-actions.ts for the full
// snapshot → wipe → restore flow and its exact scope.
//
// EXTREMELY DESTRUCTIVE. Requires founder auth (Telegram login session or
// x-cron-secret) AND an exact confirmation string in the body — a typo'd
// confirm string is rejected, not fuzzy-matched, on purpose.
import { NextRequest, NextResponse } from 'next/server';
import { requireFounderSessionOnly, verifyDestructivePassphrase } from '@/lib/admin-auth';
import { resetGenesisChain } from '@/actions/genesis-reset-actions';
import { identityPool } from '@/lib/db/identity';

const CONFIRM_PHRASE = 'RESET_EVERYTHING_I_UNDERSTAND';

export async function POST(req: NextRequest) {
  // Stricter than other admin routes on purpose — see requireFounderSessionOnly's
  // doc comment. A leaked ADMIN_SECRET must NOT be enough to wipe the chain.
  const auth = requireFounderSessionOnly(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await req.json().catch(() => ({}));

    // Second, independent factor — see verifyDestructivePassphrase's doc
    // comment. A hijacked Telegram session alone is no longer sufficient.
    const passOk = await verifyDestructivePassphrase(body?.passphrase, auth.telegramId || 'unknown');
    if (!passOk.ok) return NextResponse.json({ success: false, error: passOk.error }, { status: passOk.status });

    if (body?.confirm !== CONFIRM_PHRASE) {
      return NextResponse.json({
        success: false,
        error: 'CONFIRMATION_REQUIRED',
        message: `POST { "confirm": "${CONFIRM_PHRASE}" } to proceed. This wipes ALL chain data and cannot be undone beyond the automatic balance snapshot/restore.`,
      }, { status: 400 });
    }

    const performedBy = auth.telegramId ? `tg:${auth.telegramId}` : 'dev-bypass';
    console.warn(`[EASTCHAIN] Genesis reset triggered by ${performedBy}`);

    const result = await resetGenesisChain();

    // Persistent audit trail — survives even if Vercel's log retention rotates.
    await identityPool.query(
      `INSERT INTO identity.admin_audit_log (action, performed_by, detail) VALUES ($1, $2, $3)`,
      ['GENESIS_RESET', performedBy, JSON.stringify(result)]
    ).catch((err) => console.error('[EASTCHAIN] Failed to write admin_audit_log (non-fatal):', err));

    if (!result.success) {
      return NextResponse.json(result, { status: 500 });
    }
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[EASTCHAIN] genesis-reset route error:', err);
    return NextResponse.json({ success: false, error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
