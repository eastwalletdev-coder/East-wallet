/**
 * Explorer reads from east-validator (source of truth) via direct URL
 * or Hub HTTP proxy. Results cached in Upstash Redis to keep Vercel light.
 */
import {
  getCachedValidatorExplorerState,
  setCachedValidatorExplorerState,
  getCachedValidatorExplorerBlocks,
  setCachedValidatorExplorerBlocks,
} from '@/lib/db/redis-chain-explorer';
import { hubBases } from '@/lib/hub-urls';

const SUBUNITS = 1_000_000;

function validatorBase(): string {
  return (process.env.EAST_VALIDATOR_URL || process.env.VALIDATOR_HTTP_URL || '')
    .trim()
    .replace(/\/$/, '');
}

async function fetchJson(url: string, timeoutMs = 10_000): Promise<any | null> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: ac.signal,
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Prefer Hub /rpc/* when present (primary region, then secondary); fall back to validator direct. */
async function chainGet(path: string): Promise<{ data: any; source: 'hub' | 'validator' } | null> {
  const pathNorm = path.startsWith('/') ? path : `/${path}`;
  const val = validatorBase();

  for (const hub of hubBases()) {
    const candidates = [
      `${hub}/rpc${pathNorm}`,
      `${hub}${pathNorm}`,
    ];
    for (const u of candidates) {
      const data = await fetchJson(u);
      if (data != null) return { data, source: 'hub' };
    }
  }
  if (val) {
    const data = await fetchJson(`${val}${pathNorm}`);
    if (data != null) return { data, source: 'validator' };
  }
  return null;
}

export type ExplorerChainState = {
  status: 'active' | 'halted' | 'recovering';
  blockCount: number;
  lastBlockHash: string;
  totalMinted: number;
  buckets: Record<string, { minted: number; cap?: number }>;
  source: string;
  height: number;
  chainId?: string;
  mempoolSize?: number;
  raw?: unknown;
};

export async function getExplorerChainState(): Promise<ExplorerChainState | null> {
  const cached = await getCachedValidatorExplorerState();
  if (cached) return { ...cached, source: `${cached.source}|redis` };

  const health = await chainGet('/health');
  const supply = await chainGet('/supply');
  const latest = await chainGet('/block/latest');

  if (!health && !latest) return null;

  const h = health?.data || {};
  const bft = h.bft || {};
  const height = Number(bft.height ?? h.height ?? latest?.data?.height ?? 0) || 0;
  const hash = String(latest?.data?.hash || h.last_block_hash || '');

  let totalMinted = 0;
  const buckets: Record<string, { minted: number; cap?: number }> = {};
  const supplyBuckets = supply?.data?.buckets;
  if (Array.isArray(supplyBuckets)) {
    for (const b of supplyBuckets) {
      const name = String(b.name || b.Name || 'unknown');
      const mintedSub = Number(b.minted ?? b.Minted ?? 0) || 0;
      const capSub = Number(b.cap ?? b.Cap ?? b.max ?? 0) || 0;
      // validator buckets often store human or subunits — prefer human if small
      const minted = mintedSub > 1e12 ? mintedSub / SUBUNITS : mintedSub;
      const cap = capSub > 1e12 ? capSub / SUBUNITS : capSub;
      buckets[name] = { minted, cap };
      totalMinted += minted;
    }
  }

  const state: ExplorerChainState = {
    status: h.status === 'ok' || h.role ? 'active' : 'active',
    blockCount: height,
    lastBlockHash: hash || 'GENESIS_WAITING',
    totalMinted,
    buckets,
    source: health?.source || latest?.source || 'validator',
    height,
    chainId: h.chain_id,
    mempoolSize: h.mempool?.size,
    raw: { health: h, supply: supply?.data },
  };

  await setCachedValidatorExplorerState(state);
  return state;
}

export type ExplorerBlockRow = {
  block_index: number;
  block_hash: string;
  created_at: number;
  miner_address: string;
  validator_id: string;
  tx_type: string;
  reward: number;
  tx_count: number;
  prev_hash?: string;
};

export async function getExplorerRecentBlocks(limit = 10): Promise<ExplorerBlockRow[]> {
  const cached = await getCachedValidatorExplorerBlocks(limit);
  if (cached) return cached;

  const latest = await chainGet('/block/latest');
  if (!latest?.data) return [];

  const tip = Number(latest.data.height ?? 0) || 0;
  const rows: ExplorerBlockRow[] = [];
  const start = Math.max(0, tip - limit + 1);

  // Sequential is safer for small limit; parallel if tip known
  const heights: number[] = [];
  for (let i = tip; i >= start && heights.length < limit; i--) heights.push(i);

  const settled = await Promise.all(
    heights.map(async (height) => {
      if (height === tip && latest.data.height === tip) return latest.data;
      const r = await chainGet(`/block/${height}`);
      return r?.data || null;
    }),
  );

  for (const b of settled) {
    if (!b) continue;
    const height = Number(b.height ?? 0) || 0;
    rows.push({
      block_index: height,
      block_hash: String(b.hash || ''),
      created_at: Number(b.timestamp || Date.now()),
      miner_address: String(b.proposer || ''),
      validator_id: String(b.proposer || ''),
      tx_type: Number(b.tx_count || 0) > 0 ? 'TX' : 'EMPTY',
      reward: 0,
      tx_count: Number(b.tx_count || 0) || 0,
      prev_hash: b.prev_hash,
    });
  }

  rows.sort((a, b) => b.block_index - a.block_index);
  await setCachedValidatorExplorerBlocks(limit, rows);
  return rows;
}

export async function getExplorerAccount(address: string) {
  if (!address?.startsWith('0x')) return null;
  const r = await chainGet(`/account/${encodeURIComponent(address)}`);
  if (!r?.data) return null;
  const balanceSub = Number(r.data.balance ?? 0) || 0;
  const stakedSub = Number(r.data.staked ?? 0) || 0;
  return {
    address: address.toLowerCase(),
    balance: balanceSub / SUBUNITS,
    staked: stakedSub / SUBUNITS,
    pendingUnstake: (Number(r.data.pending_unstake ?? 0) || 0) / SUBUNITS,
    nonce: Number(r.data.nonce ?? 0) || 0,
    source: r.source,
  };
}
