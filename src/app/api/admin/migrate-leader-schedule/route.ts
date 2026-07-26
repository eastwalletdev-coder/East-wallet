// POST /api/admin/migrate-leader-schedule — Runs migrateIdentityV9 (adds
// node_type/last_heartbeat_at to identity.validators) and migrateLedgerV3
// (creates ledger.block_proposals). Idempotent, safe to call repeatedly.
import { NextRequest, NextResponse } from 'next/server';
import { migrateIdentityV9, migrateIdentityV10, migrateIdentityV11 } from '@/lib/db/identity';
import { migrateLedgerV3, migrateLedgerV4, migrateLedgerV5 } from '@/lib/db/ledger';
import { requireFounderAuth, verifyDestructivePassphrase } from '@/lib/admin-auth';

export async function POST(req: NextRequest) {
  const auth = requireFounderAuth(req);
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });

  try {
    // Second, independent factor — see verifyDestructivePassphrase's doc
    // comment. A hijacked Telegram session alone is no longer sufficient
    // to run schema migrations.
    const body = await req.json().catch(() => ({}));
    const passOk = await verifyDestructivePassphrase(body?.passphrase, auth.telegramId || 'unknown');
    if (!passOk.ok) return NextResponse.json({ success: false, error: passOk.error }, { status: passOk.status });

    await migrateIdentityV9();
    await migrateIdentityV10();
    await migrateIdentityV11();
    await migrateLedgerV3();
    await migrateLedgerV4();
    await migrateLedgerV5();
    return NextResponse.json({
      success: true,
      message: 'Migration applied: identity.validators columns, identity.genesis_reset_snapshots, ledger.block_proposals (v3+v4), and ledger.mempool (v5) are ready.',
    });
  } catch (err: any) {
    console.error('[EASTCHAIN] migrate-leader-schedule trigger error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
