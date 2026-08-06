// GET /api/archive/blocks-range?from={height}&to={height}
//
// Batched sibling of /api/archive/blocks/[heightJson].ts — same data,
// same two-tier lookup (ledger.blocks then identity.archive_blocks), same
// response shape per block, but ONE request covers an entire gap instead
// of one request (and 2 Postgres queries) per height. A 30-block catch-up
// that used to cost 60 queries now costs 2-4 total, regardless of how
// many blocks are in the range — this is the CU optimization referenced
// in lightnode/client.ts's fetchArchiveRange() and
// scripts/lib/full-node-sync.js's _catchUpFromVercel().
//
// The single-height route is left untouched and still works (Cache-Control:
// immutable, so Vercel's edge cache serves repeat single-height hits for
// free) — this is purely an additive fast path for bulk catch-up.
//
// Range is capped at MAX_RANGE to keep any one request's Postgres query
// bounded and cheap even if something requests an absurd range by mistake
// or malice — callers just loop in chunks of MAX_RANGE for anything bigger.
import { NextRequest, NextResponse } from 'next/server';
import { ledgerPool } from '@/lib/db/ledger';
import { identityPool } from '@/lib/db/identity';
import { signChainHeader } from '@/lib/consensus/chain-signing';
import { computeMerkleRoot } from '@/lib/consensus/block-math';
import { checkArchiveRateLimit } from '@/lib/db/redis';

const MAX_RANGE = 500; // blocks per request — keeps the BETWEEN scan + tx join cheap regardless of caller behavior

type BlockOut = {
  success: true;
  height: number;
  hash: string;
  previousHash: string;
  merkleRoot: string;
  validator: string | null;
  timestamp: number;
  epoch: number;
  signature: string | null;
  transactions: any[];
};

export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
  const rl = await checkArchiveRateLimit(ip);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'RATE_LIMITED' },
      { status: 429, headers: { 'Retry-After': String(rl.remainingSeconds ?? 10) } }
    );
  }

  const { searchParams } = new URL(req.url);
  const from = parseInt(searchParams.get('from') ?? '', 10);
  const to = parseInt(searchParams.get('to') ?? '', 10);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to < from) {
    return NextResponse.json({ error: 'INVALID_RANGE' }, { status: 400 });
  }
  if (to - from + 1 > MAX_RANGE) {
    return NextResponse.json({ error: 'RANGE_TOO_LARGE', maxRange: MAX_RANGE }, { status: 400 });
  }

  const found = new Map<number, BlockOut>();

  // ── Tier 1: ledger.blocks — one query for all headers in range, one for all their txs ──
  const ledgerClient = await ledgerPool.connect();
  try {
    // Prefer chain_source=validator (post cutover mirror) over legacy Neon-L2 rows
    const blockRes = await ledgerClient.query(
      `SELECT DISTINCT ON (block_index)
          block_index, block_hash, prev_hash, merkle_root, validator_id, created_at,
          COALESCE(chain_source, 'legacy') AS chain_source
       FROM ledger.blocks
       WHERE block_index BETWEEN $1 AND $2
       ORDER BY block_index ASC,
         CASE WHEN COALESCE(chain_source,'') = 'validator' THEN 0 ELSE 1 END ASC`,
      [from, to]
    );
    if (blockRes.rows.length > 0) {
      const txRes = await ledgerClient.query(
        `SELECT block_index, tx_hash, tx_type, sender_address, recipient_address, amount, gas_fee, status, created_at
         FROM ledger.transactions WHERE block_index BETWEEN $1 AND $2 ORDER BY block_index ASC, created_at ASC`,
        [from, to]
      );
      const txsByHeight = new Map<number, any[]>();
      for (const tx of txRes.rows) {
        const list = txsByHeight.get(tx.block_index) ?? [];
        list.push(tx);
        txsByHeight.set(tx.block_index, list);
      }
      for (const row of blockRes.rows) {
        const timestamp = new Date(row.created_at).getTime();
        found.set(row.block_index, {
          success: true,
          height: row.block_index,
          hash: row.block_hash,
          previousHash: row.prev_hash,
          merkleRoot: row.merkle_root,
          validator: row.validator_id,
          timestamp,
          epoch: Math.floor(timestamp / 86_400_000),
          signature: signChainHeader(row.block_index, row.block_hash),
          transactions: (txsByHeight.get(row.block_index) ?? []).map(({ block_index, ...rest }) => rest),
        });
      }
    }
  } catch (err: any) {
    console.error('[EASTCHAIN] /api/archive/blocks-range ledger.blocks lookup error:', err);
    return NextResponse.json({ error: 'DB_LOOKUP_FAILED' }, { status: 500 });
  } finally {
    ledgerClient.release();
  }

  // ── Tier 2: identity.archive_blocks — only for heights tier 1 didn't have ──
  const missing: number[] = [];
  for (let h = from; h <= to; h++) if (!found.has(h)) missing.push(h);

  if (missing.length > 0) {
    const identityClient = await identityPool.connect();
    try {
      const res = await identityClient.query(
        `SELECT block_index, block_hash, prev_hash, miner_address, block_data, archived_at
         FROM identity.archive_blocks WHERE block_index = ANY($1::int[])`,
        [missing]
      );
      for (const row of res.rows) {
        const txs: Array<{ tx_hash: string; created_at: string }> = Array.isArray(row.block_data) ? row.block_data : [];
        const txHashes = txs.map(t => t.tx_hash).filter(Boolean);
        const merkleRoot = computeMerkleRoot(txHashes);
        const timestamp = txs.length > 0
          ? new Date(txs[0].created_at).getTime()
          : new Date(row.archived_at).getTime();
        found.set(row.block_index, {
          success: true,
          height: row.block_index,
          hash: row.block_hash,
          previousHash: row.prev_hash,
          merkleRoot,
          validator: row.miner_address,
          timestamp,
          epoch: Math.floor(timestamp / 86_400_000),
          signature: signChainHeader(row.block_index, row.block_hash),
          transactions: txs,
        });
      }
    } catch (err: any) {
      console.error('[EASTCHAIN] /api/archive/blocks-range archive_blocks lookup error:', err);
      return NextResponse.json({ error: 'DB_LOOKUP_FAILED' }, { status: 500 });
    } finally {
      identityClient.release();
    }
  }

  const blocks = Array.from(found.values()).sort((a, b) => a.height - b.height);

  return NextResponse.json(
    { success: true, blocks },
    { headers: { 'Cache-Control': 'public, max-age=30' } }
  );
}
