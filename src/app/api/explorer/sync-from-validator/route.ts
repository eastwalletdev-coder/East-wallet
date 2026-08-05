/**
 * POST /api/explorer/sync-from-validator
 *
 * Mirror validator block headers → Neon ledger.blocks.
 * Auth (production): QStash signature (same as /api/empty-block)
 *   OR  x-cron-secret / Authorization Bearer === ADMIN_SECRET
 *
 * QStash schedule (console.upstash.com → QStash → Schedules):
 *   URL:  https://YOUR_VERCEL_APP/api/explorer/sync-from-validator
 *   Cron: every 1 minute  →  * * * * *
 *   Method: POST
 *   Body:  {"lookback":30}   (optional)
 */
import { NextRequest, NextResponse } from 'next/server';
import { Receiver } from '@upstash/qstash';
import { syncValidatorBlocksToNeon } from '@/lib/sync-validator-to-neon';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function verifyQStashSignature(req: NextRequest, rawBody: string): Promise<boolean> {
  const signature = req.headers.get('upstash-signature');
  const currentKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!signature || !currentKey) return false;
  try {
    const receiver = new Receiver({
      currentSigningKey: currentKey,
      nextSigningKey: nextKey || currentKey,
    });
    return await receiver.verify({ signature, body: rawBody });
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  const secret =
    req.headers.get('x-cron-secret') ||
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    '';
  const isAdmin =
    Boolean(process.env.ADMIN_SECRET) && secret === process.env.ADMIN_SECRET;
  const isQStash = await verifyQStashSignature(req, rawBody);

  if (process.env.NODE_ENV === 'production' && !isAdmin && !isQStash) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  let lookback = 20;
  try {
    const body = rawBody ? JSON.parse(rawBody) : {};
    if (body?.lookback) {
      lookback = Math.min(100, Math.max(1, Number(body.lookback) || 20));
    }
  } catch {
    /* empty / non-JSON body from QStash is fine */
  }

  const result = await syncValidatorBlocksToNeon(lookback);
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}

/** QStash can be configured as GET; same auth. */
export async function GET(req: NextRequest) {
  const signature = req.headers.get('upstash-signature');
  const secret =
    req.headers.get('x-cron-secret') ||
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    '';
  const isAdmin =
    Boolean(process.env.ADMIN_SECRET) && secret === process.env.ADMIN_SECRET;

  let isQStash = false;
  if (signature && process.env.QSTASH_CURRENT_SIGNING_KEY) {
    try {
      const receiver = new Receiver({
        currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
        nextSigningKey:
          process.env.QSTASH_NEXT_SIGNING_KEY || process.env.QSTASH_CURRENT_SIGNING_KEY,
      });
      isQStash = await receiver.verify({ signature, body: '' });
    } catch {
      isQStash = false;
    }
  }

  if (process.env.NODE_ENV === 'production' && !isAdmin && !isQStash) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const lookback = Math.min(
    100,
    Math.max(1, Number(req.nextUrl.searchParams.get('lookback') || 20) || 20),
  );
  const result = await syncValidatorBlocksToNeon(lookback);
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
