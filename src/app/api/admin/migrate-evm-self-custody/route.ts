// POST /api/admin/migrate-evm-self-custody — Runs migrateIdentityV13, which
// adds wallet_type/evm_public_key/evm_wallet_migrated_at to identity.users
// (previously manual-only SQL: migrations/003_evm_self_custody.sql, meant
// to be run by hand via psql — now wired up like every other migration).
// Safe to call repeatedly (idempotent). Admin-only, same auth pattern as
// /api/admin/migrate-self-custody.
import { NextRequest, NextResponse } from 'next/server';
import { migrateIdentityV13 } from '@/lib/db/identity';
import { requireFounderAuth } from '@/lib/admin-auth';

export async function POST(req: NextRequest) {
  const auth = requireFounderAuth(req);
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });

  try {
    await migrateIdentityV13();
    return NextResponse.json({
      success: true,
      message: 'Migration v13 applied: wallet_type/evm_public_key/evm_wallet_migrated_at columns are ready.',
    });
  } catch (err: any) {
    console.error('[EASTCHAIN] migrate-evm-self-custody trigger error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
