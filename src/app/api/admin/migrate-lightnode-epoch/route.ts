// POST /api/admin/migrate-lightnode-epoch — Runs migrateIdentityV12, which
// adds last_claim_epoch_count to identity.users (see identity.ts for why).
// Safe to call repeatedly (idempotent). Admin-only, same auth pattern as
// /api/admin/migrate-self-custody.
import { NextRequest, NextResponse } from 'next/server';
import { migrateIdentityV12 } from '@/lib/db/identity';
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

    await migrateIdentityV12();
    return NextResponse.json({
      success: true,
      message: 'Migration v12 applied: last_claim_epoch_count column is ready.',
    });
  } catch (err: any) {
    console.error('[EASTCHAIN] migrate-lightnode-epoch trigger error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
