'use server';

/**
 * @fileOverview Service to fetch transaction history.
 * getRecentTransactions() — stub, returns empty (multi-chain accounts have no
 *   real on-chain integration in this PoC, kept empty intentionally).
 * getEastTransactions(address) — real query against ledger.transactions for
 *   the EAST chain wallet.
 */
import { ledgerPool } from '@/lib/db/ledger';

export type Transaction = {
  id: string;
  type: 'send' | 'receive' | 'swap' | 'stake';
  token: string;
  amount: string;
  status: 'confirmed' | 'pending' | 'failed';
  date: string;
  address: string;
  txHash: string;
};

export type PendingTransaction = {
  txHash: string;
  type: 'send' | 'receive';
  amount: string;
  gasFee: number;
  address: string;
  submittedAt: string;
  /** How many pending tx ahead of this one have a higher gas fee (0 = next in line). */
  queuePosition: number;
};

/**
 * Fetches transaction history for multi-chain vault accounts (ETH/Base/BSC/Solana).
 * Always returns empty — no real on-chain integration for those chains in this PoC.
 */
export async function getRecentTransactions(): Promise<Transaction[]> {
  return [];
}

/**
 * Fetches EAST transactions still sitting in the gas-priority mempool
 * (see block-engine.ts's queueTransaction()/sealPendingBatch()) — these
 * haven't been sealed into a block yet, so they don't show up in
 * ledger.transactions. Lets a user track a tx hash that's still "pending"
 * and see roughly how long the queue ahead of it is.
 */
export async function getPendingEastTransactions(address: string): Promise<PendingTransaction[]> {
  if (!address) return [];
  const client = await ledgerPool.connect();
  try {
    const res = await client.query(
      `SELECT tx_hash, sender_address, recipient_address, amount, gas_fee, submitted_at,
              (SELECT COUNT(*) FROM ledger.mempool m2
               WHERE m2.status = 'pending' AND m2.gas_fee > m1.gas_fee) AS queue_position
       FROM ledger.mempool m1
       WHERE status = 'pending' AND (sender_address ILIKE $1 OR recipient_address ILIKE $1)
       ORDER BY submitted_at DESC`,
      [address]
    );

    return res.rows.map((tx: any) => {
      const isSender = tx.sender_address?.toLowerCase() === address.toLowerCase();
      return {
        txHash: tx.tx_hash,
        type: isSender ? 'send' as const : 'receive' as const,
        amount: `${isSender ? '-' : '+'}${Number(tx.amount).toLocaleString(undefined, { maximumFractionDigits: 4 })}`,
        gasFee: Number(tx.gas_fee),
        address: isSender ? tx.recipient_address : tx.sender_address,
        submittedAt: new Date(tx.submitted_at).toLocaleString('en-US', {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
          timeZone: 'UTC', hour12: false,
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

/**
 * Fetches recent EAST chain transaction history for a given wallet address.
 */
export async function getEastTransactions(address: string, limit: number = 8): Promise<Transaction[]> {
  if (!address) return [];
  const client = await ledgerPool.connect();
  try {
    const res = await client.query(
      `SELECT tx_hash, tx_type, sender_address, recipient_address, amount, status, created_at
       FROM ledger.transactions
       WHERE sender_address ILIKE $1 OR recipient_address ILIKE $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [address, limit]
    );

    return res.rows.map((tx: any) => {
      const isSender = tx.sender_address?.toLowerCase() === address.toLowerCase();
      const isStake = tx.tx_type === 'STAKE';
      const type: Transaction['type'] = isStake ? 'stake' : (isSender ? 'send' : 'receive');
      const counterparty = isSender ? tx.recipient_address : tx.sender_address;

      return {
        id: tx.tx_hash,
        txHash: tx.tx_hash,
        type,
        token: 'EAST',
        amount: `${isSender && !isStake ? '-' : '+'}${Number(tx.amount).toLocaleString(undefined, { maximumFractionDigits: 4 })}`,
        status: (tx.status as Transaction['status']) || 'confirmed',
        date: new Date(tx.created_at).toLocaleString('en-US', {
          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
          timeZone: 'UTC', hour12: false,
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
