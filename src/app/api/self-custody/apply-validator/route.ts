// POST /api/self-custody/apply-validator
// Plain REST wrapper around applyAsValidatorCandidate() in
// self-custody-actions.ts — same rationale as /api/self-custody/register.
import { NextRequest, NextResponse } from 'next/server';
import { applyAsValidatorCandidate } from '@/actions/self-custody-actions';

export async function POST(req: NextRequest) {
  try {
    const { telegramId, pubkeyHex, signatureHex, initData } = await req.json();
    if (!telegramId || !pubkeyHex || !signatureHex) {
      return NextResponse.json({ success: false, error: 'MISSING_FIELDS' }, { status: 400 });
    }
    const adminSecret = req.headers.get('x-cron-secret') || undefined;
    const result = await applyAsValidatorCandidate(telegramId, pubkeyHex, signatureHex, initData || '', adminSecret);
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err: any) {
    console.error('[EASTCHAIN] self-custody/apply-validator error:', err);
    return NextResponse.json({ success: false, error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
