// POST /api/node/heartbeat
// Called periodically (e.g. every 30s) by a validator's own long-running
// node process — NOT from inside the Telegram Mini App, which only runs
// while the user has it open and can't heartbeat in the background.
//
// Body: { telegramId, timestampMs, signature }
// The node signs `HEARTBEAT|{telegramId}|{timestampMs}` with its
// self-custody key, verified against identity.users.self_custody_pubkey
// (the same key registered via registerSelfCustody). Does NOT require
// telegramId to already be an "elected" validator (top-N PoC winner from
// runEpoch()) — any self-custody node can heartbeat in and become a
// fallback production candidate, ranked last by score until it earns a
// real one. See recordValidatorHeartbeat()/getActiveExternalValidators()
// in identity.ts and leader-schedule.ts's score-priority pickLeader().
import { NextRequest, NextResponse } from 'next/server';
import { identityPool, recordValidatorHeartbeat } from '@/lib/db/identity';
import { verifySignature } from '@/lib/keypair-service';

const MAX_CLOCK_SKEW_MS = 60_000; // reject heartbeats timestamped >60s off

export async function POST(req: NextRequest) {
  try {
    const { telegramId, timestampMs, signature } = await req.json();

    if (!telegramId || !timestampMs || !signature) {
      return NextResponse.json({ success: false, error: 'MISSING_FIELDS' }, { status: 400 });
    }

    if (Math.abs(Date.now() - Number(timestampMs)) > MAX_CLOCK_SKEW_MS) {
      return NextResponse.json({ success: false, error: 'TIMESTAMP_OUT_OF_RANGE' }, { status: 400 });
    }

    const client = await identityPool.connect();
    let pubkey: string | null = null;
    let walletAddress: string | null = null;
    try {
      const res = await client.query(
        `SELECT self_custody_pubkey, wallet_address FROM identity.users WHERE telegram_id = $1`,
        [telegramId]
      );
      if (res.rows.length > 0) {
        pubkey = res.rows[0].self_custody_pubkey;
        walletAddress = res.rows[0].wallet_address;
      }
    } finally {
      client.release();
    }

    if (!pubkey || !walletAddress) {
      return NextResponse.json({ success: false, error: 'SELF_CUSTODY_REQUIRED' }, { status: 403 });
    }

    const message = `HEARTBEAT|${telegramId}|${timestampMs}`;
    const validSignature = await verifySignature(pubkey, message, signature);
    if (!validSignature) {
      return NextResponse.json({ success: false, error: 'INVALID_SIGNATURE' }, { status: 401 });
    }

    await recordValidatorHeartbeat(telegramId, walletAddress);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[EASTCHAIN] heartbeat error:', err);
    return NextResponse.json({ success: false, error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
