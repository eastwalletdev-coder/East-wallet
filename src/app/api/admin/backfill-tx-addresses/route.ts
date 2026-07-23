// POST /api/admin/backfill-tx-addresses — Fixes "Recent Activity disappeared
// after self-custody upgrade" by repointing old ledger.transactions /
// ledger.mempool rows (still keyed to a user's pre-migration address) at
// their current wallet_address. See src/lib/db/tx-address-backfill.ts for
// the full explanation and safety properties.
//
// Does NOT touch identity.users (balance, cooldown, wallet_address) or any
// schema — only UPDATEs existing sender_address/recipient_address values,
// and only on rows still sitting on the old address. Safe to re-run.
//
// Body (all optional):
//   { telegramId?: string, dryRun?: boolean (default true) }
// Always defaults to dryRun — you must explicitly pass { dryRun: false }
// to actually write anything. Run dry-run first, review `details`, then
// apply. Recommended: try one telegramId first before running for everyone.
//
// Admin-only, same auth pattern as the other /api/admin/* routes.
import { NextRequest, NextResponse } from 'next/server';
import { requireFounderAuth } from '@/lib/admin-auth';
import { backfillTransactionAddresses, rollbackTransactionAddresses } from '@/lib/db/tx-address-backfill';
import { identityPool } from '@/lib/db/identity';

export async function POST(req: NextRequest) {
  const auth = requireFounderAuth(req);
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });

  try {
    const body = await req.json().catch(() => ({}));
    const telegramId: string | undefined = body?.telegramId;
    const dryRun: boolean = body?.dryRun !== false; // default true — must opt in to writing

    // Rollback mode — pass back the `details` array from a previous
    // non-dry-run response (or the admin_audit_log entry it was recorded
    // in) to precisely undo it.
    if (body?.rollback && Array.isArray(body?.details)) {
      const result = await rollbackTransactionAddresses(body.details);
      const performedBy = auth.telegramId ? `tg:${auth.telegramId}` : 'cron-secret';
      await identityPool.query(
        `INSERT INTO identity.admin_audit_log (action, performed_by, detail) VALUES ($1, $2, $3)`,
        ['BACKFILL_TX_ADDRESSES_ROLLBACK', performedBy, JSON.stringify(result)]
      ).catch((err) => console.error('[EASTCHAIN] Failed to write admin_audit_log (non-fatal):', err));
      return NextResponse.json({ success: true, ...result });
    }

    const result = await backfillTransactionAddresses(telegramId, dryRun);

    // Audit log only on real writes — keeps dry-run calls cheap/quiet, and
    // gives you the exact tx-hash lists needed for rollback later.
    if (!dryRun) {
      const performedBy = auth.telegramId ? `tg:${auth.telegramId}` : 'cron-secret';
      await identityPool.query(
        `INSERT INTO identity.admin_audit_log (action, performed_by, detail) VALUES ($1, $2, $3)`,
        ['BACKFILL_TX_ADDRESSES', performedBy, JSON.stringify(result)]
      ).catch((err) => console.error('[EASTCHAIN] Failed to write admin_audit_log (non-fatal):', err));
    }

    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[EASTCHAIN] backfill-tx-addresses error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
