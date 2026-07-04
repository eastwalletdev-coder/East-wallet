import { NextRequest, NextResponse } from 'next/server';
import { identityPool } from '@/lib/db/identity';
import { MINING_COOLDOWN_MS } from '@/lib/contracts/mining-contract';

// Reads the AUTHORITATIVE cooldown straight from Postgres (last_mining_claim_at),
// the same field mining-contract.ts's row-locked check enforces. Previously this
// read Redis's fast pre-check instead — but Redis fails open ({allowed:true})
// whenever UPSTASH_REDIS_REST_URL/TOKEN aren't set, so the UI would show
// "ready to mine" while the real claim still got rejected with COOLDOWN_ACTIVE.
export async function GET(req: NextRequest) {
  const tgId = req.nextUrl.searchParams.get('tgId');
  if (!tgId) return NextResponse.json({ allowed: true, remainingSeconds: 0 });

  try {
    const res = await identityPool.query(
      'SELECT last_mining_claim_at FROM identity.users WHERE telegram_id = $1',
      [tgId]
    );
    const lastClaimAt = Number(res.rows[0]?.last_mining_claim_at || 0);
    if (lastClaimAt <= 0) return NextResponse.json({ allowed: true, remainingSeconds: 0 });

    const elapsed = Date.now() - lastClaimAt;
    if (elapsed >= MINING_COOLDOWN_MS) return NextResponse.json({ allowed: true, remainingSeconds: 0 });

    return NextResponse.json({
      allowed: false,
      remainingSeconds: Math.ceil((MINING_COOLDOWN_MS - elapsed) / 1000),
    });
  } catch {
    return NextResponse.json({ allowed: true, remainingSeconds: 0 });
  }
}