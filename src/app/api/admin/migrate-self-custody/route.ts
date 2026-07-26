// POST /api/admin/migrate-self-custody — Runs migrateIdentityV8, which adds
// self_custody_pubkey/self_custody_migrated_at to identity.users and creates
// identity.validator_candidates. Safe to call repeatedly (idempotent).
// Admin-only, same auth pattern as /api/admin/run-epoch and
// /api/admin/backfill-keypairs.
import { NextRequest, NextResponse } from 'next/server';
import { migrateIdentityV8 } from '@/lib/db/identity';
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

    await migrateIdentityV8();
    return NextResponse.json({
      success: true,
      message: 'Migration v8 applied: self_custody_pubkey/self_custody_migrated_at columns + identity.validator_candidates table are ready.',
    });
  } catch (err: any) {
    console.error('[EASTCHAIN] migrate-self-custody trigger error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
