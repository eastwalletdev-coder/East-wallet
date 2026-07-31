// GET /api/admin/suspicious-full-nodes — read-only list of flagged sync
// attestations (see identity.ts's full_node_sync_attestations doc comment
// for the detection design). No enforcement action happens here — this is
// visibility only, for manual founder review.
import { NextRequest, NextResponse } from 'next/server';
import { listSuspiciousFullNodeResets } from '@/lib/db/identity';
import { requireFounderAuth } from '@/lib/admin-auth';

export async function GET(req: NextRequest) {
  const auth = requireFounderAuth(req);
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });

  try {
    const rows = await listSuspiciousFullNodeResets(50);
    return NextResponse.json({ success: true, rows });
  } catch (err: any) {
    console.error('[EASTCHAIN] suspicious-full-nodes fetch error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
