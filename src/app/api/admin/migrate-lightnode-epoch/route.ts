// POST /api/admin/migrate-lightnode-epoch — Runs migrateIdentityV12, which
// adds last_claim_epoch_count to identity.users (see identity.ts for why).
// Safe to call repeatedly (idempotent). Admin-only, same auth pattern as
// /api/admin/migrate-self-custody.
import { NextRequest, NextResponse } from 'next/server';
import { migrateIdentityV12 } from '@/lib/db/identity';
import { requireFounderAuth } from '@/lib/admin-auth';

export async function POST(req: NextRequest) {
  const auth = requireFounderAuth(req);
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });

  try {
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
