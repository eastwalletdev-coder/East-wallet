// POST /api/admin/migrate-leader-schedule — Runs migrateIdentityV9 (adds
// node_type/last_heartbeat_at to identity.validators) and migrateLedgerV3
// (creates ledger.block_proposals). Idempotent, safe to call repeatedly.
import { NextRequest, NextResponse } from 'next/server';
import { migrateIdentityV9 } from '@/lib/db/identity';
import { migrateLedgerV3 } from '@/lib/db/ledger';
import { requireFounderAuth } from '@/lib/admin-auth';

export async function POST(req: NextRequest) {
  const auth = requireFounderAuth(req);
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });

  try {
    await migrateIdentityV9();
    await migrateLedgerV3();
    return NextResponse.json({
      success: true,
      message: 'Migration applied: identity.validators.node_type/last_heartbeat_at + ledger.block_proposals are ready.',
    });
  } catch (err: any) {
    console.error('[EASTCHAIN] migrate-leader-schedule trigger error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
