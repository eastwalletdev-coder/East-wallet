// POST /api/self-custody/register
// Plain REST wrapper around registerSelfCustody() in self-custody-actions.ts.
// Server Actions are meant to be called from the Next.js app itself (React
// forms/components) — not a stable contract for external scripts. This
// route exists so a standalone Node.js CLI (see scripts/apply-validator-cli.js)
// can register a self-custody pubkey without going through the Mini App UI.
import { NextRequest, NextResponse } from 'next/server';
import { registerSelfCustody } from '@/actions/self-custody-actions';

export async function POST(req: NextRequest) {
  try {
    const { telegramId, pubkeyHex, signatureHex, initData } = await req.json();
    if (!telegramId || !pubkeyHex || !signatureHex) {
      return NextResponse.json({ success: false, error: 'MISSING_FIELDS' }, { status: 400 });
    }
    const adminSecret = req.headers.get('x-cron-secret') || undefined;
    const result = await registerSelfCustody(telegramId, pubkeyHex, signatureHex, initData || '', adminSecret);
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (err: any) {
    console.error('[EASTCHAIN] self-custody/register error:', err);
    return NextResponse.json({ success: false, error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
