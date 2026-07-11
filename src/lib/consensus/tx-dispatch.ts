/**
 * EASTCHAIN — Transaction dispatch registry
 * ─────────────────────────────────────────────────────────────────────
 * FIXES A CRITICAL BUG: the original mempool design held commitFn/
 * rollbackFn as in-memory JS closures on a module-level array, triggered
 * by a bare setTimeout(). If the Vercel serverless instance that queued a
 * transaction was frozen/recycled before that timer fired — which
 * Vercel does not guarantee against once a response has been sent — the
 * closures were lost. Result: sender's funds already debited at
 * submission time, but neither the recipient credit (commitFn) nor the
 * sender refund (rollbackFn) would ever run. Money stuck in limbo with
 * no automatic recovery.
 *
 * The fix: every pending transaction's commit/rollback behavior is now
 * derived from data ALREADY PERSISTED in ledger.mempool (tx_type,
 * sender_id, recipient_id, amount, gas_fee, payload) — never from a
 * closure that only exists in one process's memory. Any instance,
 * triggered by any mechanism (QStash cron, or the opportunistic
 * best-effort fast path), can pick up a pending row and correctly
 * process it, because the "how to commit/rollback this tx_type" logic
 * lives here as pure functions keyed by tx_type, not in a closure.
 *
 * To add a new tx_type to the gas-priority mempool, register it here.
 */
import { identityPool } from '@/lib/db/identity';
import { invalidateCachedUser } from '@/lib/db/redis';

export interface MempoolRow {
  txHash: string;
  txType: string;
  senderId: string;
  recipientId: string;
  amount: number;
  gasFee: number;
  payload: Record<string, any>;
}

export interface TxDispatchHandlers {
  /** Runs AFTER the block containing this tx is sealed — apply the state change. */
  commit: (row: MempoolRow) => Promise<void>;
  /** Runs if the tx ultimately fails to seal — undo whatever was reserved at submission time. */
  rollback: (row: MempoolRow) => Promise<void>;
}

const REGISTRY: Record<string, TxDispatchHandlers> = {
  TRANSFER: {
    commit: async (row) => {
      await identityPool.query(
        'UPDATE identity.users SET balance = balance + $1, updated_at = NOW() WHERE telegram_id = $2',
        [row.amount, row.recipientId]
      );
      await invalidateCachedUser(row.recipientId);
    },
    rollback: async (row) => {
      const totalDebit = row.amount + row.gasFee;
      await identityPool.query(
        'UPDATE identity.users SET balance = balance + $1, updated_at = NOW() WHERE telegram_id = $2',
        [totalDebit, row.senderId]
      );
      await invalidateCachedUser(row.senderId);
      console.error(`[EASTCHAIN] TRANSFER rollback: refunded ${totalDebit} EAST to ${row.senderId} (tx ${row.txHash} failed to seal)`);
    },
  },
};

export function getDispatchHandlers(txType: string): TxDispatchHandlers | null {
  return REGISTRY[txType] || null;
}

export function registerTxDispatch(txType: string, handlers: TxDispatchHandlers): void {
  REGISTRY[txType] = handlers;
}
