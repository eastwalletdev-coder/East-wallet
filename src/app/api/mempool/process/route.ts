// POST /api/mempool/process — reliably seal pending gas-priority mempool
// transactions (triggered by QStash on a short interval, e.g. every 10s).
//
// THIS IS THE FIX for the critical bug where a bare in-process setTimeout
// could be lost if Vercel recycled the instance before it fired. Since
// sealPendingBatch() reconstructs commit/rollback behavior entirely from
// the durable ledger.mempool row (see tx-dispatch.ts), it doesn't matter
// which instance — or which trigger — calls this; a transaction queued
// by one instance and picked up here by a totally different one will
// still resolve correctly.
import { NextRequest, NextResponse } from 'next/server';
import { sealPendingBatch } from '@/lib/block-engine';
import { Receiver } from '@upstash/qstash';

async function verifyQStashSignature(req: NextRequest, rawBody: string): Promise<boolean> {
  const signature = req.headers.get('upstash-signature');
  const currentKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!signature || !currentKey) return false;
  try {
    const receiver = new Receiver({ currentSigningKey: currentKey, nextSigningKey: nextKey || currentKey });
    return await receiver.verify({ signature, body: rawBody });
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const secret = req.headers.get('x-cron-secret');
  const isAdmin = secret === process.env.ADMIN_SECRET;
  const isQStash = await verifyQStashSignature(req, rawBody);

  if (process.env.NODE_ENV === 'production' && !isAdmin && !isQStash) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await sealPendingBatch();
    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[EASTCHAIN] mempool/process error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
