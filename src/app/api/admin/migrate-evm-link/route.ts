// POST /api/admin/migrate-evm-link — Runs migrateIdentityV5, which adds
// linked_evm_address to identity.users (needed for the secp256k1/EVM
// dual-path signature verification in contracts/engine.ts). This existed
// in identity.ts already but was never wired to any trigger endpoint —
// the column would never actually be created without this route.
// Safe to call repeatedly (idempotent). Admin-only, same auth pattern as
// the other /api/admin/migrate-* routes.
import { NextRequest, NextResponse } from 'next/server';
import { migrateIdentityV5 } from '@/lib/db/identity';
import { requireFounderAuth } from '@/lib/admin-auth';

export async function POST(req: NextRequest) {
  const auth = requireFounderAuth(req);
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });

  try {
    await migrateIdentityV5();
    return NextResponse.json({
      success: true,
      message: 'Migration v5 applied: identity.users.linked_evm_address column is ready.',
    });
  } catch (err: any) {
    console.error('[EASTCHAIN] migrate-evm-link trigger error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
