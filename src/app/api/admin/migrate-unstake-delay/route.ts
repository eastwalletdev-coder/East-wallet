// POST /api/admin/migrate-unstake-delay — Runs migrateIdentityV14, which adds
// pending_unstake_amount / pending_unstake_claimable_at to identity.users.
// Needed for the new EastPass staking widget's "request unstake now, claim
// funds after a 24h delay" flow (lib/contracts/staking-contract.ts's
// requestUnstake/claimUnstake). Purely additive — no existing column is
// touched or removed. Safe to call repeatedly (idempotent, ADD COLUMN IF
// NOT EXISTS). Admin-only, same auth pattern as the other
// /api/admin/migrate-* routes. Run this once before using the new stake
// widget in production.
import { NextRequest, NextResponse } from 'next/server';
import { migrateIdentityV14 } from '@/lib/db/identity';
import { requireFounderAuth } from '@/lib/admin-auth';

export async function POST(req: NextRequest) {
  const auth = requireFounderAuth(req);
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });

  try {
    await migrateIdentityV14();
    return NextResponse.json({
      success: true,
      message: 'Migration v14 applied: identity.users.pending_unstake_amount / pending_unstake_claimable_at columns are ready.',
    });
  } catch (err: any) {
    console.error('[EASTCHAIN] migrate-unstake-delay trigger error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
