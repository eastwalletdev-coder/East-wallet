// POST /api/admin/migrate-full-node-schema — creates identity.full_node_agreements.
// Purely additive (CREATE TABLE IF NOT EXISTS), safe to call repeatedly.
// Same admin-passphrase-gated pattern as the other /api/admin/migrate-* routes.
import { NextRequest, NextResponse } from 'next/server';
import { migrateFullNodeSchema } from '@/lib/db/identity';
import { requireFounderAuth, verifyDestructivePassphrase } from '@/lib/admin-auth';

export async function POST(req: NextRequest) {
  const auth = requireFounderAuth(req);
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });

  try {
    const body = await req.json().catch(() => ({}));
    const passOk = await verifyDestructivePassphrase(body?.passphrase, auth.telegramId || 'unknown');
    if (!passOk.ok) return NextResponse.json({ success: false, error: passOk.error }, { status: passOk.status });

    await migrateFullNodeSchema();
    return NextResponse.json({
      success: true,
      message: 'Full node schema applied: identity.full_node_agreements is ready.',
    });
  } catch (err: any) {
    console.error('[EASTCHAIN] migrate-full-node-schema trigger error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
