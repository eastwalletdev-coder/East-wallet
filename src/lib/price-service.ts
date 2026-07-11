"use server"

/**
 * EASTCHAIN — Price Feed Service
 * ─────────────────────────────────────────────────────────────────────
 * Real USD prices from CoinGecko's public API (no key required for the
 * /simple/price endpoint, generous free-tier rate limit). Fixes the
 * gap where Token.value was hardcoded to '$0.00' and Token.change was
 * hardcoded to '+0.00%' regardless of actual balance.
 *
 * In-memory cache with a short TTL — this is a server module, so the
 * cache is shared across requests on the same server instance. Keeps
 * us well under CoinGecko's rate limit even with many users loading
 * the wallet tab at once, and avoids a price-fetch round trip blocking
 * every single balance load.
 */

type PriceEntry = { usd: number; usd_24h_change: number };

const CACHE_TTL_MS = 45_000; // 45s — balances update slower than prices actually move meaningfully in a wallet UI
let cache: { data: Record<string, PriceEntry>; fetchedAt: number } | null = null;

// symbol+chain → CoinGecko coin id. Only tokens actually wired to real
// balance fetching in token-service.ts need an entry here.
const COINGECKO_ID: Record<string, string> = {
  'ETH': 'ethereum',
  'WBTC': 'wrapped-bitcoin',
  'USDC': 'usd-coin',
  'USDT': 'tether',
  'SOL': 'solana',
  'BNB': 'binancecoin',
};

async function fetchLivePrices(): Promise<Record<string, PriceEntry>> {
  const ids = Array.from(new Set(Object.values(COINGECKO_ID))).join(',');
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;

  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`CoinGecko responded ${res.status}`);
  const json = await res.json();

  // Re-key from coingecko id → our token symbol for easy lookup
  const bySymbol: Record<string, PriceEntry> = {};
  for (const [symbol, id] of Object.entries(COINGECKO_ID)) {
    if (json[id]) {
      bySymbol[symbol] = { usd: json[id].usd, usd_24h_change: json[id].usd_24h_change ?? 0 };
    }
  }
  return bySymbol;
}

/**
 * Returns { usd, usd_24h_change } for every known symbol, using the
 * cache when fresh. Never throws — on fetch failure, returns the last
 * good cache if we have one (stale-but-real beats fake), or an empty
 * object if we've never successfully fetched (callers show '—', not
 * a fabricated $0.00).
 */
export async function getLivePrices(): Promise<Record<string, PriceEntry>> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.data;
  }
  try {
    const data = await fetchLivePrices();
    cache = { data, fetchedAt: Date.now() };
    return data;
  } catch (err) {
    console.error('[EASTCHAIN] Price feed fetch failed:', err);
    return cache?.data || {};
  }
}

export function formatUsd(amount: number): string {
  if (!Number.isFinite(amount)) return '—';
  return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: amount < 1 ? 4 : 2 });
}

export function formatChangePercent(pct: number): string {
  if (!Number.isFinite(pct)) return '—';
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}
