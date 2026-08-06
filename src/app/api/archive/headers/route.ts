/**
 * GET /api/archive/headers?from=100&to=200
 * Neon-backed archive for lightnode/fullnode catch-up (Hub stays live tip only).
 *
 * Returns validator-shaped headers from ledger.blocks (after QStash mirror upsert).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getArchiveHeaders, getArchiveTip } from '@/lib/archive-headers';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  if (sp.get('tip') === '1' || sp.get('tip') === 'true') {
    const tip = await getArchiveTip();
    return NextResponse.json(
      tip || { height: -1, hash: '', source: 'empty' },
      { headers: { 'Cache-Control': 'public, max-age=5' } },
    );
  }

  const from = Number(sp.get('from') ?? sp.get('fromHeight') ?? 0);
  const to = Number(sp.get('to') ?? sp.get('toHeight') ?? from);
  const limit = Number(sp.get('limit') ?? 100);

  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to < from) {
    return NextResponse.json({ error: 'invalid_range' }, { status: 400 });
  }
  if (to - from > 200) {
    return NextResponse.json({ error: 'range_too_large', max: 200 }, { status: 400 });
  }

  const headers = await getArchiveHeaders(from, to, limit);
  return NextResponse.json(
    {
      ok: true,
      from,
      to,
      count: headers.length,
      headers,
    },
    { headers: { 'Cache-Control': 'public, max-age=10' } },
  );
}
