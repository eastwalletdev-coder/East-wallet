// GET /api/archive/blocks/{height}.json
//
// Last-resort fallback for a Light Node's gap-fill, behind the WebRTC
// peer mesh (see lightnode/client.ts + webrtc-peer.ts, where every node
// keeps its own last-1000-block local cache and serves peers that ask).
// This route serves the same JSON shape directly from Postgres, which
// has full block history — no external storage service involved.
//
// Two-tier lookup: ledger.blocks (the live/hot table) first, then
// identity.archive_blocks ("Cold Storage" — see performRollingArchive()
// in mining-actions.ts, the whitepaper's "Rolling Archive & Pruning"
// section) as a fallback. As of when this was written, performRollingArchive()
// only ever COPIES into archive_blocks and never deletes from ledger.blocks,
// so in practice every height is still found in the first tier — but the
// second tier exists so this route keeps working if that pruning is ever
// completed (i.e. a DELETE FROM ledger.blocks gets added) without silently
// 404ing on every height older than whatever the prune cutoff ends up being.
//
// archive_blocks doesn't store merkleRoot or the original seal timestamp
// directly (see its schema in identity.ts) — merkleRoot is recomputed from
// the tx hashes preserved in its block_data JSONB column (same input,
// same computeMerkleRoot(), same output), and the timestamp is taken from
// those same transactions' created_at (inserted atomically with the block
// in block-engine.ts, so it's accurate) — archived_at is only used as a
// last-resort for genuinely empty blocks, where neither exists.
//
// Signature is recomputed here rather than read from storage: neither
// table ever stored it (see block-engine.ts — signChainHeader() output
// only ever went to Railway, never persisted). secp256k1 signing via
// ethers' SigningKey is deterministic (RFC 6979) — signing the same
// (height, hash) with the same CHAIN_SIGNING_PRIVATE_KEY always produces
// the same valid signature, so this works for blocks sealed before the
// signing key was even configured, not just new ones.
//
// To actually use this: just set NEXT_PUBLIC_APP_URL to this app's own
// domain, e.g. https://thiseast.vercel.app — lightnode/client.ts appends
// "/api/archive/blocks/{height}" itself, so don't include that suffix
// here. NEXT_PUBLIC_ARCHIVE_BASE_URL only needs setting if the archive
// should be served from a DIFFERENT domain than the main app (e.g. R2
// with a custom domain) — leave it unset otherwise, since it would
// otherwise just duplicate NEXT_PUBLIC_APP_URL with no added benefit.
import { NextRequest, NextResponse } from 'next/server';
import { ledgerPool } from '@/lib/db/ledger';
import { identityPool } from '@/lib/db/identity';
import { signChainHeader } from '@/lib/consensus/chain-signing';
import { computeMerkleRoot } from '@/lib/consensus/block-math';
import { checkArchiveRateLimit } from '@/lib/db/redis';

export async function GET(req: NextRequest, { params }: { params: Promise<{ heightJson: string }> }) {
  // Rate-limit BEFORE touching Postgres — this endpoint has no auth (by
  // design, block headers are public data), so it needs to survive being
  // hit directly instead of through a real syncing Light Node.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
  const rl = await checkArchiveRateLimit(ip);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'RATE_LIMITED' },
      { status: 429, headers: { 'Retry-After': String(rl.remainingSeconds ?? 10) } }
    );
  }

  const { heightJson } = await params;
  // "681.json" -> 681 (parseInt stops at the first non-digit character)
  const height = parseInt(heightJson, 10);
  if (!Number.isFinite(height) || height < 0) {
    return NextResponse.json({ error: 'INVALID_HEIGHT' }, { status: 400 });
  }

  // ── Tier 1: ledger.blocks (live table, has every field directly) ──
  const ledgerClient = await ledgerPool.connect();
  try {
    const res = await ledgerClient.query(
      `SELECT block_index, block_hash, prev_hash, merkle_root, validator_id, created_at
       FROM ledger.blocks WHERE block_index = $1 LIMIT 1`,
      [height]
    );
    if (res.rows.length > 0) {
      const row = res.rows[0];
      const timestamp = new Date(row.created_at).getTime();
      return NextResponse.json({
        success: true, // required by catchUpFromArchive() in lightnode/client.ts — without it every response here was treated as a missing block
        height: row.block_index,
        hash: row.block_hash,
        previousHash: row.prev_hash,
        merkleRoot: row.merkle_root,
        validator: row.validator_id,
        timestamp,
        epoch: Math.floor(timestamp / 86_400_000),
        signature: signChainHeader(row.block_index, row.block_hash), // null if CHAIN_SIGNING_PRIVATE_KEY unset — same behavior as live sealing
      }, {
        headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }, // block content is immutable once sealed
      });
    }
  } catch (err: any) {
    console.error('[EASTCHAIN] /api/archive/blocks ledger.blocks lookup error:', err);
    return NextResponse.json({ error: 'DB_LOOKUP_FAILED' }, { status: 500 });
  } finally {
    ledgerClient.release();
  }

  // ── Tier 2: identity.archive_blocks ("Cold Storage") ──
  // Only reached once/if ledger.blocks has actually been pruned for this
  // height — see the header comment above for why that's not happening yet.
  const identityClient = await identityPool.connect();
  try {
    const res = await identityClient.query(
      `SELECT block_index, block_hash, prev_hash, miner_address, block_data, archived_at
       FROM identity.archive_blocks WHERE block_index = $1 LIMIT 1`,
      [height]
    );
    if (res.rows.length === 0) {
      return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
    }
    const row = res.rows[0];
    const txs: Array<{ tx_hash: string; created_at: string }> = Array.isArray(row.block_data) ? row.block_data : [];
    const txHashes = txs.map(t => t.tx_hash).filter(Boolean);

    const merkleRoot = computeMerkleRoot(txHashes);
    // Transactions are inserted atomically with the block in block-engine.ts,
    // so any of their created_at values is an accurate proxy for the
    // original seal time. Empty blocks have nothing to go on — archived_at
    // (when it was copied into Cold Storage, not when it was sealed) is the
    // best remaining approximation for those.
    const timestamp = txs.length > 0
      ? new Date(txs[0].created_at).getTime()
      : new Date(row.archived_at).getTime();

    return NextResponse.json({
      success: true, // required by catchUpFromArchive() in lightnode/client.ts — without it every response here was treated as a missing block
      height: row.block_index,
      hash: row.block_hash,
      previousHash: row.prev_hash,
      merkleRoot,
      validator: row.miner_address,
      timestamp,
      epoch: Math.floor(timestamp / 86_400_000),
      signature: signChainHeader(row.block_index, row.block_hash),
    }, {
      headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
    });
  } catch (err: any) {
    console.error('[EASTCHAIN] /api/archive/blocks archive_blocks lookup error:', err);
    return NextResponse.json({ error: 'DB_LOOKUP_FAILED' }, { status: 500 });
  } finally {
    identityClient.release();
  }
}
