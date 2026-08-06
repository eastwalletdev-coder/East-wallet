/**
 * Client-side recent activity for on-chain EAST txs.
 * Validator txs often never land in Neon ledger.transactions — this keeps
 * Send / receive / stake / unstake visible in Wallet → Activity.
 */
export type LocalActivity = {
  id: string;
  txHash: string;
  type: 'send' | 'receive' | 'stake' | 'unstake' | 'claim';
  token: string;
  amount: string;
  status: 'confirmed' | 'pending' | 'failed';
  date: string;
  address: string;
  /** ISO for sort */
  at: number;
};

const KEY = 'east_chain_activity_v1';
const MAX = 40;

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

export function listLocalActivity(forAddress?: string): LocalActivity[] {
  const all = readAll();
  if (!forAddress) return all;
  const a = forAddress.toLowerCase();
  return all.filter(
    (x) =>
      x.address?.toLowerCase() === a ||
      // also keep rows where this wallet was actor (id embeds from)
      x.id.toLowerCase().includes(a.slice(2, 10)),
  );
}

export function pushLocalActivity(entry: Omit<LocalActivity, 'id' | 'at' | 'date'> & { txHash: string }) {
  const at = Date.now();
  const row: LocalActivity = {
    id: entry.txHash || `local-${at}`,
    txHash: entry.txHash,
    type: entry.type,
    token: entry.token || 'EAST',
    amount: entry.amount,
    status: entry.status || 'pending',
    address: entry.address || '',
    at,
    date:
      new Date(at).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }) + ' local',
  };
  const prev = readAll().filter((x) => x.txHash !== row.txHash);
  writeAll([row, ...prev]);
  return row;
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
