// GET /api/archive/blocks/[height]
//
// Serves one archived block header, by height, straight from Postgres
// (ledger.blocks) — no Cloudflare R2 involved.
//
// This replaces the old R2-backed archive: Light Nodes that are further
// behind than Railway's small in-memory ring buffer can cover (see
// RAILWAY_BACKFILL_LIMIT / catchUpFromArchive in lightnode/client.ts)
// used to fetch immutable JSON objects directly from R2's CDN. Since R2
// isn't part of the deployment anymore, this endpoint fills the same gap
// from the canonical source of truth (ledger.blocks) instead. It costs a
// real Vercel invocation + DB read per call — see checkArchiveRateLimit
// in db/redis.ts for the resulting rate limit, and set
// NEXT_PUBLIC_ARCHIVE_BASE_URL to this app's own URL (or leave it unset
// and lightnode/client.ts falls back to NEXT_PUBLIC_APP_URL).
//
// No auth by design (Light Nodes call this directly, unauthenticated,
// same as the old R2 objects were public) — rate limiting is the only
// guard, same pattern as other unauthenticated read endpoints.
import { NextRequest, NextResponse } from 'next/server';
import { ledgerPool } from '@/lib/db/ledger';
import { checkArchiveRateLimit } from '@/lib/db/redis';
import { signChainHeader } from '@/lib/consensus/chain-signing';

export async function GET(req: NextRequest, { params }: { params: Promise<{ height: string }> }) {
  try {
    // Best-effort client identifier for rate limiting — Vercel sets
    // x-forwarded-for; fall back to a shared bucket if it's ever missing
    // rather than failing the request.
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rateLimit = await checkArchiveRateLimit(ip);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { success: false, error: 'RATE_LIMITED', remainingSeconds: rateLimit.remainingSeconds },
        { status: 429 }
      );
    }

    const { height: heightParam } = await params;
    const height = Number(heightParam);
    if (!Number.isInteger(height) || height < 0) {
      return NextResponse.json({ success: false, error: 'INVALID_HEIGHT' }, { status: 400 });
    }

    const result = await ledgerPool.query(
      `SELECT block_index, block_hash, prev_hash, merkle_root, validator_id, created_at
       FROM ledger.blocks WHERE block_index = $1 LIMIT 1`,
      [height]
    );
    const row = result.rows[0];
    if (!row) {
      return NextResponse.json({ success: false, error: 'NOT_FOUND' }, { status: 404 });
    }

    const timestamp = new Date(row.created_at).getTime();
    const header = {
      height: row.block_index,
      hash: row.block_hash,
      previousHash: row.prev_hash,
      merkleRoot: row.merkle_root,
      validator: row.validator_id,
      timestamp,
      epoch: Math.floor(timestamp / 86_400_000),
      // Recomputed on the fly rather than stored — signChainHeader is pure
      // (same key + height + hash always produces the same signature), so
      // there's no need for a dedicated column. Null if CHAIN_SIGNING_PRIVATE_KEY
      // isn't configured, same as when the block was first sealed.
      signature: signChainHeader(row.block_index, row.block_hash),
    };

    // This block's contents never change once sealed — safe to let
    // Vercel's edge/CDN cache it essentially forever, same as the old
    // immutable R2 objects did.
    return NextResponse.json(
      { success: true, ...header },
      { headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } }
    );
  } catch (err: any) {
    console.error('[EASTCHAIN] archive block fetch error:', err);
    return NextResponse.json({ success: false, error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
