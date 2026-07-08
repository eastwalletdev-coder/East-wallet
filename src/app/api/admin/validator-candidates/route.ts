// GET /api/admin/validator-candidates — list pending/all candidates
// POST /api/admin/validator-candidates — approve or reject a candidate
import { NextRequest, NextResponse } from 'next/server';
import { listValidatorCandidates, reviewValidatorCandidate } from '@/lib/db/identity';
import { requireFounderAuth } from '@/lib/admin-auth';

export async function GET(req: NextRequest) {
  const auth = requireFounderAuth(req);
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });

  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status') as 'pending_review' | 'approved' | 'rejected' | null;

    const candidates = await listValidatorCandidates(status || undefined);
    return NextResponse.json({ success: true, candidates });
  } catch (err: any) {
    console.error('[EASTCHAIN] validator-candidates GET error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = requireFounderAuth(req);
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });

  try {
    const { telegramId, decision, notes } = await req.json();

    if (!telegramId || !decision || !['approved', 'rejected'].includes(decision)) {
      return NextResponse.json(
        { success: false, error: 'MISSING_OR_INVALID_FIELDS' },
        { status: 400 }
      );
    }

    // Reviewer identity comes from the verified session (or 'cron' for the
    // machine-secret path) — never from client-supplied body — so the
    // audit trail (`reviewed_by`) can't be spoofed by whoever calls this.
    const reviewedBy = auth.telegramId ? `tg:${auth.telegramId}` : 'cron';

    await reviewValidatorCandidate(telegramId, decision, reviewedBy, notes || '');
    return NextResponse.json({ success: true, message: `Candidate ${decision}` });
  } catch (err: any) {
    console.error('[EASTCHAIN] validator-candidates POST error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
