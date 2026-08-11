/**
 * Best-effort write to ledger.transactions so recipients see "receive"
 * in getEastTransactions / Recent Activity (Neon).
 * Does not affect validator state — indexing only.
 */
import { ledgerPool } from '@/lib/db/ledger';

export async function recordTransferForActivity(params: {
  txHash: string;
  from: string;
  to: string;
  /** Human EAST or subunits — stored as numeric amount for display */
  amount: number;
  amountIsSubunits?: boolean;
  status?: string;
}): Promise<void> {
  const hash = (params.txHash || '').trim();
  const from = (params.from || '').toLowerCase();
  const to = (params.to || '').toLowerCase();
  if (!hash || !from.startsWith('0x') || !to.startsWith('0x')) return;

  // Prefer human EAST in ledger if amount was subunits (1e18 or 1e6 style)
  let amount = params.amount;
  if (params.amountIsSubunits && amount >= 1e6) {
    // Heuristic: 18-decimal chain uses 1e18; older 6-decimal uses 1e6
    if (amount >= 1e15) amount = amount / 1e18;
    else amount = amount / 1e6;
  }

  const client = await ledgerPool.connect();
  try {
    await client.query(
      `INSERT INTO ledger.transactions
         (tx_hash, tx_type, sender_address, recipient_address, amount, status, created_at)
       VALUES ($1, 'TRANSFER', $2, $3, $4, $5, NOW())
       ON CONFLICT (tx_hash) DO NOTHING`,
      [hash, from, to, amount, params.status || 'confirmed'],
    );
  } catch (err) {
    // Table/constraint may differ — never fail the user tx
    console.warn('[EASTCHAIN] recordTransferForActivity:', (err as Error)?.message || err);
  } finally {
    client.release();
  }
}
