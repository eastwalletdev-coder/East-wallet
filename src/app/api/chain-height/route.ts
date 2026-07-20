// GET /api/chain-height — the actual current chain tip, straight from
// Postgres (ledger.blocks). Railway's own `welcome.latestHeight` is NOT
// reliable for this: it's just whatever block:new broadcasts Railway has
// seen since its OWN last restart, not the real chain height. A validator
// daemon catching up needs the authoritative number, so it asks here
// instead of trusting Railway's self-reported figure.
import { NextResponse } from 'next/server';
import { ledgerPool } from '@/lib/db/ledger';

export async function GET() {
  const client = await ledgerPool.connect();
  try {
    const res = await client.query('SELECT MAX(block_index) AS latest FROM ledger.blocks');
    const latestHeight = res.rows[0]?.latest !== null ? Number(res.rows[0].latest) : -1;
    return NextResponse.json(
      { latestHeight },
      { headers: { 'Cache-Control': 'public, max-age=5' } } // short cache — this one DOES change constantly
    );
  } catch (err: any) {
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: err.message }, { status: 500 });
  } finally {
    client.release();
  }
}
