// POST — additive column identity.users.early_bird_bonus
import { NextRequest, NextResponse } from 'next/server';
import { identityPool } from '@/lib/db/identity';
import { requireFounderAuth, verifyDestructivePassphrase } from '@/lib/admin-auth';

export async function POST(req: NextRequest) {
  const auth = requireFounderAuth(req);
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });

  try {
    const body = await req.json().catch(() => ({}));
    const passOk = await verifyDestructivePassphrase(body?.passphrase, auth.telegramId || 'unknown');
    if (!passOk.ok) return NextResponse.json({ success: false, error: passOk.error }, { status: passOk.status });

    const client = await identityPool.connect();
    try {
      await client.query(`
        ALTER TABLE identity.users
        ADD COLUMN IF NOT EXISTS early_bird_bonus BOOLEAN NOT NULL DEFAULT false
      `);
    } finally {
      client.release();
    }
    return NextResponse.json({
      success: true,
      message: 'early_bird_bonus column ready on identity.users',
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
