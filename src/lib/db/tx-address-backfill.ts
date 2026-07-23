/**
 * EASTCHAIN — Backfill orphaned transaction addresses
 * ─────────────────────────────────────────────────────────────────────
 * Fixes the "recent activity disappeared after upgrading to self-custody"
 * bug: wallet-onboarding-actions.ts's upgradeToSelfCustodyWallet()
 * OVERWRITES identity.users.wallet_address in place when a user migrates
 * from the deterministic 'custodial_hash' address to a self-custody
 * 'self_custody_evm' address. It never stores the old address anywhere.
 *
 * Balance is fine (keyed by telegram_id). Transaction HISTORY is not —
 * getEastTransactions()/getPendingEastTransactions() in
 * transaction-service.ts query ledger.transactions/ledger.mempool by
 * address. Once wallet_address changes, old rows (still on the old
 * address) stop matching and vanish from Recent Activity.
 *
 * This module recomputes the old address deterministically (the exact
 * same function that originally assigned it — see blockchain.ts's
 * generateWalletFromTelegramId) and repoints old rows at the new
 * address.
 *
 * Safety properties, on purpose:
 *  - Does NOT touch identity.users (balance, cooldown timestamps,
 *    wallet_address, wallet_type) at all — claim/send/cooldown logic is
 *    keyed off telegram_id and current wallet_address there and is
 *    completely untouched by anything here.
 *  - Does NOT touch schema — no new columns, no new tables. Only UPDATEs
 *    existing sender_address/recipient_address values.
 *  - Only ever matches rows still on the OLD address. Rows already on
 *    the new address (i.e. every transaction made after migration) are
 *    never touched — so this is idempotent and re-run-safe, and cannot
 *    clobber legitimate new activity.
 *  - dryRun (default) reports exactly what WOULD change, with the tx
 *    hashes, without writing anything.
 *  - The exact tx hashes touched are returned so a precise, scoped
 *    rollback is possible (see rollbackTransactionAddresses) instead of
 *    a blanket "set back to old address" that could revert unrelated
 *    rows that happen to share the new address.
 */
import { identityPool } from '@/lib/db/identity';
import { ledgerPool } from '@/lib/db/ledger';
import { generateWalletFromTelegramId } from '@/lib/blockchain';

export interface BackfillUserResult {
  telegramId: string;
  oldAddress: string;
  newAddress: string;
  txSenderHashes: string[];
  txRecipientHashes: string[];
  mempoolSenderHashes: string[];
  mempoolRecipientHashes: string[];
}

export interface BackfillSummary {
  dryRun: boolean;
  usersScanned: number;
  usersWithMatches: number;
  totalRowsMatched: number;
  totalRowsUpdated: number;
  details: BackfillUserResult[];
}

export async function backfillTransactionAddresses(
  onlyTelegramId?: string,
  dryRun: boolean = true
): Promise<BackfillSummary> {
  const identityClient = await identityPool.connect();
  let migratedUsers: { telegram_id: string; wallet_address: string }[];
  try {
    const res = await identityClient.query(
      `SELECT telegram_id, wallet_address FROM identity.users
       WHERE wallet_type = 'self_custody_evm' AND evm_wallet_migrated_at IS NOT NULL
       ${onlyTelegramId ? 'AND telegram_id = $1' : ''}`,
      onlyTelegramId ? [onlyTelegramId] : []
    );
    migratedUsers = res.rows;
  } finally {
    identityClient.release();
  }

  const details: BackfillUserResult[] = [];
  let totalMatched = 0;
  let totalUpdated = 0;

  for (const u of migratedUsers) {
    const oldAddress = generateWalletFromTelegramId(u.telegram_id);
    const newAddress = u.wallet_address;
    if (oldAddress.toLowerCase() === newAddress.toLowerCase()) continue; // sanity guard, shouldn't happen

    const ledgerClient = await ledgerPool.connect();
    try {
      await ledgerClient.query('BEGIN');

      const txSender = await ledgerClient.query(
        `SELECT tx_hash FROM ledger.transactions WHERE sender_address ILIKE $1`, [oldAddress]
      );
      const txRecipient = await ledgerClient.query(
        `SELECT tx_hash FROM ledger.transactions WHERE recipient_address ILIKE $1`, [oldAddress]
      );
      const mpSender = await ledgerClient.query(
        `SELECT tx_hash FROM ledger.mempool WHERE sender_address ILIKE $1`, [oldAddress]
      );
      const mpRecipient = await ledgerClient.query(
        `SELECT tx_hash FROM ledger.mempool WHERE recipient_address ILIKE $1`, [oldAddress]
      );

      const rowsMatched =
        txSender.rows.length + txRecipient.rows.length + mpSender.rows.length + mpRecipient.rows.length;

      if (!dryRun && rowsMatched > 0) {
        if (txSender.rows.length) {
          await ledgerClient.query(`UPDATE ledger.transactions SET sender_address = $1 WHERE sender_address ILIKE $2`, [newAddress, oldAddress]);
        }
        if (txRecipient.rows.length) {
          await ledgerClient.query(`UPDATE ledger.transactions SET recipient_address = $1 WHERE recipient_address ILIKE $2`, [newAddress, oldAddress]);
        }
        if (mpSender.rows.length) {
          await ledgerClient.query(`UPDATE ledger.mempool SET sender_address = $1 WHERE sender_address ILIKE $2`, [newAddress, oldAddress]);
        }
        if (mpRecipient.rows.length) {
          await ledgerClient.query(`UPDATE ledger.mempool SET recipient_address = $1 WHERE recipient_address ILIKE $2`, [newAddress, oldAddress]);
        }
      }

      await ledgerClient.query(!dryRun && rowsMatched > 0 ? 'COMMIT' : 'ROLLBACK');

      if (rowsMatched > 0) {
        details.push({
          telegramId: u.telegram_id,
          oldAddress,
          newAddress,
          txSenderHashes: txSender.rows.map((r: any) => r.tx_hash),
          txRecipientHashes: txRecipient.rows.map((r: any) => r.tx_hash),
          mempoolSenderHashes: mpSender.rows.map((r: any) => r.tx_hash),
          mempoolRecipientHashes: mpRecipient.rows.map((r: any) => r.tx_hash),
        });
        totalMatched += rowsMatched;
        if (!dryRun) totalUpdated += rowsMatched;
      }
    } catch (err) {
      await ledgerClient.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      ledgerClient.release();
    }
  }

  return {
    dryRun,
    usersScanned: migratedUsers.length,
    usersWithMatches: details.length,
    totalRowsMatched: totalMatched,
    totalRowsUpdated: totalUpdated,
    details,
  };
}

/**
 * Precisely reverses a previously-applied (non-dry-run) backfill using the
 * exact tx_hash lists from that run's response/audit log entry. Only
 * touches rows whose tx_hash is in the recorded list AND whose address
 * still equals the new address (defensive — skips anything that changed
 * again since) — never a blanket "set back to old", which could revert
 * genuinely-new transactions that happen to share the new address.
 */
export async function rollbackTransactionAddresses(
  details: BackfillUserResult[]
): Promise<{ rowsReverted: number }> {
  let reverted = 0;
  const ledgerClient = await ledgerPool.connect();
  try {
    await ledgerClient.query('BEGIN');
    for (const d of details) {
      if (d.txSenderHashes.length) {
        const r = await ledgerClient.query(
          `UPDATE ledger.transactions SET sender_address = $1 WHERE tx_hash = ANY($2) AND sender_address ILIKE $3`,
          [d.oldAddress, d.txSenderHashes, d.newAddress]
        );
        reverted += r.rowCount || 0;
      }
      if (d.txRecipientHashes.length) {
        const r = await ledgerClient.query(
          `UPDATE ledger.transactions SET recipient_address = $1 WHERE tx_hash = ANY($2) AND recipient_address ILIKE $3`,
          [d.oldAddress, d.txRecipientHashes, d.newAddress]
        );
        reverted += r.rowCount || 0;
      }
      if (d.mempoolSenderHashes.length) {
        const r = await ledgerClient.query(
          `UPDATE ledger.mempool SET sender_address = $1 WHERE tx_hash = ANY($2) AND sender_address ILIKE $3`,
          [d.oldAddress, d.mempoolSenderHashes, d.newAddress]
        );
        reverted += r.rowCount || 0;
      }
      if (d.mempoolRecipientHashes.length) {
        const r = await ledgerClient.query(
          `UPDATE ledger.mempool SET recipient_address = $1 WHERE tx_hash = ANY($2) AND recipient_address ILIKE $3`,
          [d.oldAddress, d.mempoolRecipientHashes, d.newAddress]
        );
        reverted += r.rowCount || 0;
      }
    }
    await ledgerClient.query('COMMIT');
  } catch (err) {
    await ledgerClient.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    ledgerClient.release();
  }
  return { rowsReverted: reverted };
}
