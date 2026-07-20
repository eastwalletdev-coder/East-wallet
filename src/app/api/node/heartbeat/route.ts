// POST /api/node/heartbeat
// Called periodically (e.g. every 30s) by a validator's own long-running
// node process — NOT from inside the Telegram Mini App, which only runs
// while the user has it open and can't heartbeat in the background.
//
// Body: { telegramId, timestampMs, signature }
// The node signs `HEARTBEAT|{telegramId}|{timestampMs}` with its
// self-custody key. We verify against identity.users.self_custody_pubkey
// (the same key registered via registerSelfCustody) and require the
// telegramId to already be an active validator (elected by runEpoch) —
// heartbeating in does not grant validator status by itself, it only
// proves liveness for someone already elected.
//
// CU note: this used to hit Postgres (a SELECT JOIN + an UPDATE) on every
// single call, forever — at a 30s cadence that's a steady drip that never
// lets Neon's free-tier compute autosuspend. Now: (1) rate-limited via
// Redis before anything else, (2) the pubkey/is_active lookup is cached
// (see getCachedValidatorAuth in db/redis.ts — 5 min TTL, this data barely
// ever changes), and (3) the actual Postgres last_heartbeat_at UPDATE is
// throttled to at most once per 3 min per validator (Redis's own heartbeat
// key is already the fast-path freshness source; Postgres just needs to
// stay roughly fresh as the durable fallback for when Redis is down).
import { NextRequest, NextResponse } from 'next/server';
import { identityPool, recordValidatorHeartbeat } from '@/lib/db/identity';
import { verifySignature } from '@/lib/keypair-service';
import {
  recordHeartbeatRedis,
  checkHeartbeatRateLimit,
  getCachedValidatorAuth,
  setCachedValidatorAuth,
  shouldWriteHeartbeatToPostgres,
} from '@/lib/db/redis';

const MAX_CLOCK_SKEW_MS = 60_000; // reject heartbeats timestamped >60s off

export async function POST(req: NextRequest) {
  try {
    const { telegramId, timestampMs, signature } = await req.json();

    if (!telegramId || !timestampMs || !signature) {
      return NextResponse.json({ success: false, error: 'MISSING_FIELDS' }, { status: 400 });
    }

    const rl = await checkHeartbeatRateLimit(telegramId);
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, error: 'RATE_LIMITED' },
        { status: 429, headers: { 'Retry-After': String(rl.remainingSeconds ?? 30) } }
      );
    }

    if (Math.abs(Date.now() - Number(timestampMs)) > MAX_CLOCK_SKEW_MS) {
      return NextResponse.json({ success: false, error: 'TIMESTAMP_OUT_OF_RANGE' }, { status: 400 });
    }

    let pubkey: string | null = null;
    let isActiveValidator = false;

    const cachedAuth = await getCachedValidatorAuth(telegramId);
    if (cachedAuth) {
      pubkey = cachedAuth.pubkey;
      isActiveValidator = cachedAuth.isActiveValidator;
    } else {
      const client = await identityPool.connect();
      try {
        const res = await client.query(
          `SELECT u.self_custody_pubkey, v.is_active
           FROM identity.users u
           LEFT JOIN identity.validators v ON v.telegram_id = u.telegram_id
           WHERE u.telegram_id = $1`,
          [telegramId]
        );
        if (res.rows.length > 0) {
          pubkey = res.rows[0].self_custody_pubkey;
          isActiveValidator = res.rows[0].is_active === true;
        }
      } finally {
        client.release();
      }
      if (pubkey) {
        await setCachedValidatorAuth(telegramId, { pubkey, isActiveValidator });
      }
    }

    if (!pubkey) {
      return NextResponse.json({ success: false, error: 'SELF_CUSTODY_REQUIRED' }, { status: 403 });
    }
    if (!isActiveValidator) {
      return NextResponse.json({ success: false, error: 'NOT_AN_ACTIVE_VALIDATOR' }, { status: 403 });
    }

    const message = `HEARTBEAT|${telegramId}|${timestampMs}`;
    const validSignature = await verifySignature(pubkey, message, signature);
    if (!validSignature) {
      return NextResponse.json({ success: false, error: 'INVALID_SIGNATURE' }, { status: 401 });
    }

    // Redis is the fast-path freshness source (read on every leader-pick) —
    // always update it. Postgres is the durable fallback — only touched
    // when the throttle window has elapsed.
    await recordHeartbeatRedis(telegramId);
    if (await shouldWriteHeartbeatToPostgres(telegramId)) {
      await recordValidatorHeartbeat(telegramId);
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[EASTCHAIN] heartbeat error:', err);
    return NextResponse.json({ success: false, error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
