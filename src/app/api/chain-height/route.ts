/**
 * GET /api/chain-height
 *
 * Network tip for lightnode catch-up. MUST be east-validator height,
 * NOT Neon ledger.blocks MAX(block_index).
 *
 * Neon still holds old L2 heights (e.g. 461) that do not exist on the
 * Railway validator (~40+). Using Neon here makes lightnodes request
 * 0→461 from Hub/peers and hang forever.
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function validatorBase(): string {
  return (process.env.EAST_VALIDATOR_URL || process.env.VALIDATOR_HTTP_URL || '')
    .trim()
    .replace(/\/$/, '');
}

function hubBase(): string {
  return (process.env.RAILWAY_HUB_URL || process.env.EAST_HUB_URL || '')
    .trim()
    .replace(/\/$/, '');
}

async function fetchJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function tipFromValidator(): Promise<{ latestHeight: number; source: string; hash?: string } | null> {
  const val = validatorBase();
  const hub = hubBase();

  // 1) Validator /block/latest
  if (val) {
    const latest = await fetchJson(`${val}/block/latest`);
    if (latest && latest.height != null) {
      return {
        latestHeight: Number(latest.height) || 0,
        source: 'validator/block/latest',
        hash: latest.hash,
      };
    }
    // 2) Validator /health → bft.height
    const health = await fetchJson(`${val}/health`);
    const h = health?.bft?.height ?? health?.height;
    if (h != null && Number(h) >= 0) {
      return { latestHeight: Number(h) || 0, source: 'validator/health' };
    }
  }

  // 3) Hub health embedded chain tip
  if (hub) {
    const hubHealth = await fetchJson(`${hub}/health`);
    const raw = hubHealth?.chain?.raw;
    const h = raw?.bft?.height ?? hubHealth?.hub?.latestHeaderHeight;
    if (h != null && Number(h) >= 0) {
      return { latestHeight: Number(h) || 0, source: 'hub/health' };
    }
    const hubLatest = await fetchJson(`${hub}/rpc/block/latest`);
    if (hubLatest?.height != null) {
      return {
        latestHeight: Number(hubLatest.height) || 0,
        source: 'hub/rpc/block/latest',
        hash: hubLatest.hash,
      };
    }
  }

  return null;
}

export async function GET() {
  const tip = await tipFromValidator();
  if (!tip) {
    return NextResponse.json(
      {
        latestHeight: -1,
        error: 'validator_unreachable',
        hint: 'Set EAST_VALIDATOR_URL (or RAILWAY_HUB_URL). Do not use Neon height.',
      },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return NextResponse.json(
    {
      latestHeight: tip.latestHeight,
      source: tip.source,
      hash: tip.hash ?? null,
    },
    { headers: { 'Cache-Control': 'public, max-age=5' } },
  );
}
