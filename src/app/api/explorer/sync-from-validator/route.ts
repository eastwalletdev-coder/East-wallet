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
  const isAdmin = Boolean(process.env.ADMIN_SECRET) && secret === process.env.ADMIN_SECRET;
  const isQStash = await verifyQStashSignature(req, rawBody);

  if (process.env.NODE_ENV === 'production' && !isAdmin && !isQStash) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  let lookback = 50;
  try {
    const body = rawBody ? JSON.parse(rawBody) : {};
    if (body?.lookback) lookback = Math.min(200, Math.max(1, Number(body.lookback) || 50));
  } catch {
    /* ok */
  }

  const result = await syncValidatorBlocksToNeon(lookback);
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
