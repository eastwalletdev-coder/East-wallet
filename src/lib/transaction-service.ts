'use server';

/**
 * EAST activity from Neon ledger (L2 history + neon mempool).
 * On-chain validator txs are also shown via client localStorage
 * (see chain-activity-local.ts) because they often never hit ledger.transactions.
 */
import { ledgerPool } from '@/lib/db/ledger';

export type Transaction = {
  id: string;
  type: 'send' | 'receive' | 'swap' | 'stake' | 'unstake' | 'claim';
  token: string;
  amount: string;
  status: 'confirmed' | 'pending' | 'failed';
  date: string;
  address: string;
  txHash: string;
};

export type PendingTransaction = {
  txHash: string;
  type: 'send' | 'receive' | 'stake' | 'unstake';
  amount: string;
  gasFee: number;
  address: string;
  submittedAt: string;
  queuePosition: number;
};

export async function getRecentTransactions(): Promise<Transaction[]> {
  return [];
}

export async function getPendingEastTransactions(address: string): Promise<PendingTransaction[]> {
  if (!address) return [];
  const client = await ledgerPool.connect();
  try {
    const res = await client.query(
      `SELECT tx_hash, sender_address, recipient_address, amount, gas_fee, submitted_at, tx_type,
              (SELECT COUNT(*) FROM ledger.mempool m2
               WHERE m2.status = 'pending' AND m2.gas_fee > m1.gas_fee) AS queue_position
       FROM ledger.mempool m1
       WHERE status = 'pending' AND (sender_address ILIKE $1 OR recipient_address ILIKE $1)
       ORDER BY submitted_at DESC
       LIMIT 20`,
      [address],
    );

    return res.rows.map((tx: any) => {
      const isSender = tx.sender_address?.toLowerCase() === address.toLowerCase();
      const t = String(tx.tx_type || 'TRANSFER').toUpperCase();
      let type: PendingTransaction['type'] = isSender ? 'send' : 'receive';
      if (t.includes('STAKE') && !t.includes('UNSTAKE')) type = 'stake';
      if (t.includes('UNSTAKE')) type = 'unstake';
      return {
        txHash: tx.tx_hash,
        type,
        amount: `${isSender ? '-' : '+'}${Number(tx.amount).toLocaleString(undefined, { maximumFractionDigits: 9 })}`,
        gasFee: Number(tx.gas_fee),
        address: isSender ? tx.recipient_address : tx.sender_address,
        submittedAt:
          new Date(tx.submitted_at).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'UTC',
            hour12: false,
          }) + ' UTC',
        queuePosition: Number(tx.queue_position) + 1,
      };
    });
  } catch (err) {
    console.error('[EASTCHAIN] getPendingEastTransactions error:', err);
    return [];
  } finally {
    client.release();
  }
}

export async function getEastTransactions(address: string, limit: number = 20): Promise<Transaction[]> {
  if (!address) return [];
  const client = await ledgerPool.connect();
  try {
    const res = await client.query(
      `SELECT tx_hash, tx_type, sender_address, recipient_address, amount, status, created_at
       FROM ledger.transactions
       WHERE sender_address ILIKE $1 OR recipient_address ILIKE $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [address, limit],
    );

    return res.rows.map((tx: any) => {
      const isSender = tx.sender_address?.toLowerCase() === address.toLowerCase();
      const t = String(tx.tx_type || '').toUpperCase();
      let type: Transaction['type'] = isSender ? 'send' : 'receive';
      if (t.includes('STAKE') && !t.includes('UNSTAKE')) type = 'stake';
      else if (t.includes('UNSTAKE')) type = 'unstake';
      else if (t.includes('CLAIM')) type = 'claim';
      const counterparty = isSender ? tx.recipient_address : tx.sender_address;

      return {
        id: tx.tx_hash,
        txHash: tx.tx_hash,
        type,
        token: 'EAST',
        amount: `${isSender && type === 'send' ? '-' : type === 'send' ? '-' : '+'}${Number(tx.amount).toLocaleString(undefined, { maximumFractionDigits: 9 })}`,
        status: (tx.status as Transaction['status']) || 'confirmed',
        date:
          new Date(tx.created_at).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'UTC',
            hour12: false,
          }) + ' UTC',
        address: counterparty || '',
      };
    });
  } catch (err) {
    console.error('[EASTCHAIN] getEastTransactions error:', err);
    return [];
  } finally {
    client.release();
  }
}
