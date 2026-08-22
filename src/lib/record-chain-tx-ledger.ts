/**
 * Index on-chain transfers into ledger.transactions so self-custody
 * recipients see "receive" in Recent Activity (Neon index only).
 */
import { ledgerPool } from '@/lib/db/ledger';

export async function recordTransferForActivity(params: {
  txHash: string;
  from: string;
  to: string;
  amount: number;
  amountIsSubunits?: boolean;
  status?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const hash = (params.txHash || '').trim();
  const from = (params.from || '').trim().toLowerCase();
  const to = (params.to || '').trim().toLowerCase();
  if (!hash || !from.startsWith('0x') || !to.startsWith('0x')) {
    return { ok: false, error: 'bad_params' };
  }

  let amount = Number(params.amount);
  if (!Number.isFinite(amount) || amount < 0) amount = 0;
  if (params.amountIsSubunits && amount >= 1e6) {
    if (amount >= 1e15) amount = amount / 1e18;
    else amount = amount / 1_000_000;
  }

  // Sentinel: not from L2 seal engine; still queryable by recipient address
  const blockIndex = -1;

  const client = await ledgerPool.connect();
  try {
    await client.query(
      `INSERT INTO ledger.transactions
         (tx_hash, block_index, tx_type, sender_address, recipient_address,
          sender_id, recipient_id, amount, gas_fee, status, created_at)
       VALUES ($1, $2, 'TRANSFER', $3, $4, 'chain', 'chain', $5, 0, $6, NOW())
       ON CONFLICT (tx_hash) DO UPDATE SET
         status = EXCLUDED.status,
         amount = COALESCE(NULLIF(EXCLUDED.amount, 0), ledger.transactions.amount)`,
      [hash, blockIndex, from, to, amount, params.status || 'confirmed'],
    );
    return { ok: true };
  } catch (err) {
    const msg = (err as Error)?.message || String(err);
    console.warn('[EASTCHAIN] recordTransferForActivity:', msg);
    return { ok: false, error: msg };
  } finally {
    client.release();
  }
}
