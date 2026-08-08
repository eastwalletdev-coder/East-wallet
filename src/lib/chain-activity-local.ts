/**
 * Client-side recent activity for on-chain EAST txs.
 * Keyed by the USER wallet (actor), not only the counterparty.
 */
export type LocalActivity = {
  id: string;
  txHash: string;
  type: 'send' | 'receive' | 'stake' | 'unstake' | 'claim' | 'migrate';
  token: string;
  amount: string;
  status: 'confirmed' | 'pending' | 'failed';
  date: string;
  /** Counterparty (to for send, from for receive) */
  address: string;
  /** The wallet on this device that performed / owns the row */
  wallet: string;
  at: number;
};

const KEY = 'east_chain_activity_v1';
const MAX = 50;

function readAll(): LocalActivity[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(items: LocalActivity[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(items.slice(0, MAX)));
  } catch {
    /* quota */
  }
}

/** List activity for a wallet address (sender or receiver or stored wallet field). */
export function listLocalActivity(forAddress?: string): LocalActivity[] {
  const all = readAll();
  if (!forAddress) return all;
  const a = forAddress.toLowerCase();
  return all.filter((x) => {
    const wallet = (x.wallet || '').toLowerCase();
    const counter = (x.address || '').toLowerCase();
    // Legacy rows (no wallet field): still show if counterparty matches OR always if no filter keys
    if (wallet && wallet === a) return true;
    if (counter === a) return true;
    // Legacy send rows only stored recipient in address — show all local rows when filter
    // is set and wallet field missing (device-local log is single-user)
    if (!x.wallet) return true;
    return false;
  });
}

export function pushLocalActivity(
  entry: Omit<LocalActivity, 'id' | 'at' | 'date'> & {
    txHash: string;
    wallet: string;
    address: string;
  },
) {
  const at = Date.now();
  const row: LocalActivity = {
    id: entry.txHash || `local-${at}`,
    txHash: entry.txHash,
    type: entry.type,
    token: entry.token || 'EAST',
    amount: entry.amount,
    status: entry.status || 'pending',
    address: entry.address || '',
    wallet: (entry.wallet || '').toLowerCase(),
    at,
    date: new Date(at).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }),
  };
  const prev = readAll().filter((x) => x.txHash !== row.txHash);
  writeAll([row, ...prev]);
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('east-chain-activity', { detail: row }));
    }
  } catch { /* ignore */ }
  return row;
}

/** All rows on this device (Mini App = one user). Prefer this on Home. */
export function listAllLocalActivity(): LocalActivity[] {
  return readAll();
}

export function markLocalActivityStatus(txHash: string, status: LocalActivity['status']) {
  const all = readAll();
  let changed = false;
  for (const x of all) {
    if (x.txHash === txHash && x.status !== status) {
      x.status = status;
      changed = true;
    }
  }
  if (changed) writeAll(all);
}
