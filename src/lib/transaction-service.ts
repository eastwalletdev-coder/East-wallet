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
};

/**
 * Fetches transaction history for multi-chain vault accounts (ETH/Base/BSC/Solana).
 * Always returns empty — no real on-chain integration for those chains in this PoC.
 */
export async function getRecentTransactions(): Promise<Transaction[]> {
  return [];
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
