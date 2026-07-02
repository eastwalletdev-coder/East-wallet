// POST /api/admin/backfill-keypairs — Generate Ed25519 public keys for
// users that don't have one yet (old users from before the keypair system).
// Optional body: { telegramId: "123" } to (re)generate a single user.
// Admin-only, same auth pattern as /api/admin/run-epoch.
import { NextRequest, NextResponse } from 'next/server';
import { backfillKeypairs } from '@/lib/db/identity';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  const isAdmin = secret === process.env.ADMIN_SECRET;

  if (process.env.NODE_ENV === 'production' && !isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const telegramId: string | undefined = body?.telegramId;

    const { updated, total } = await backfillKeypairs(telegramId);

    return NextResponse.json({
      success: true,
      scope: telegramId ? `single user (${telegramId})` : 'all users missing public_key',
      updated,
      total,
    });
  } catch (err: any) {
    console.error('[EASTCHAIN] Keypair backfill trigger error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
