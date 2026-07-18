'use server';

/**
 * EASTCHAIN — Genesis Reset (with balance snapshot + on-chain restore)
 * ─────────────────────────────────────────────────────────────────────
 * Wipes all chain-derived state (blocks, transactions, mempool, staking
 * positions, mint counters) back to zero, then restores every affected
 * user's balance via REAL on-chain GENESIS_RESTORE transactions on the
 * fresh chain — never a silent UPDATE. This means the very first block(s)
 * after reset are a transparent, auditable "airdrop" crediting everyone
 * back to their pre-reset balance.
 *
 * SCOPE (deliberately limited): only chain-derived NUMBERS are reset —
 * balance, staked_amount, stake_locked_until, total_referral_bonus, and
 * ledger.supply_buckets.minted. Identity itself (telegram_id, wallet
 * address, keys, self-custody pubkey, EAST PASS tier, referral graph,
 * founder flag) is left untouched — a "genesis reset" resets the chain,
 * not your users' accounts.
 *
 * EXTREMELY DESTRUCTIVE AND IRREVERSIBLE beyond the snapshot itself.
 * Only reachable through /api/admin/genesis-reset, which requires
 * requireFounderAuth() AND an exact confirmation string in the body —
 * see that route for the double-check.
 */
import crypto from 'crypto';
import { identityPool } from '@/lib/db/identity';
import { ledgerPool } from '@/lib/db/ledger';
import { sealBlock, type PendingTx } from '@/lib/block-engine';

const SYSTEM_ADDRESS = '0x0000000000000000000000000000000000000000';
const RESTORE_BATCH_SIZE = 10; // mirrors MAX_TX_PER_BLOCK in block-engine.ts
const FOUNDER_IDS = (process.env.FOUNDER_IDS || '').split(',').map((id) => id.trim()).filter(Boolean);

// New founder vesting terms (per whitepaper update): 12-month cliff, then
// released monthly for 36 more months — 48 months total before fully
// unlocked. Total allocation unchanged at 50,000,000 EAST.
const FOUNDER_VESTING_TOTAL = 50_000_000;
const FOUNDER_VESTING_CLIFF_MONTHS = 12;
const FOUNDER_VESTING_RELEASE_MONTHS = 36; // releases AFTER the cliff — total duration = 12 + 36 = 48

function generateTxHash(type: string, id: string): string {
  return '0x' + crypto.createHash('sha256')
    .update(`${type}_${id}_${Date.now()}_${Math.random()}`)
    .digest('hex');
}

export interface GenesisResetResult {
  success: boolean;
  resetBatchId?: string;
  usersSnapshotted?: number;
  usersRestored?: number;
  blocksCreated?: number;
  error?: string;
}

export async function resetGenesisChain(): Promise<GenesisResetResult> {
  const resetBatchId = crypto.randomUUID();

  try {
    // ── 1. Snapshot every user with a non-zero balance/stake ──────────
    const snapshotRes = await identityPool.query(
      `INSERT INTO identity.genesis_reset_snapshots
         (reset_batch_id, telegram_id, wallet_address, balance, staked_amount, stake_locked_until, total_referral_bonus)
       SELECT $1, telegram_id, wallet_address, balance, staked_amount, stake_locked_until, total_referral_bonus
       FROM identity.users
       WHERE balance > 0 OR staked_amount > 0
       RETURNING telegram_id, wallet_address, balance, staked_amount, stake_locked_until`,
      [resetBatchId]
    );
    const snapshots = snapshotRes.rows;
    console.log(`[EASTCHAIN] Genesis reset ${resetBatchId}: snapshotted ${snapshots.length} user(s)`);

    // ── 2. Wipe chain-derived ledger state ────────────────────────────
    const ledgerClient = await ledgerPool.connect();
    try {
      await ledgerClient.query('BEGIN');
      await ledgerClient.query(`
        TRUNCATE TABLE
          ledger.blocks, ledger.transactions, ledger.mempool,
          ledger.block_proposals, ledger.staking_positions,
          ledger.mint_log, ledger.contract_calls, ledger.contract_nonces,
          ledger.saga_log, ledger.checkpoints
        RESTART IDENTITY CASCADE;
      `);
      await ledgerClient.query(`UPDATE ledger.supply_buckets SET minted = 0, updated_at = NOW();`);
      await ledgerClient.query('COMMIT');
    } catch (err) {
      await ledgerClient.query('ROLLBACK');
      throw err;
    } finally {
      ledgerClient.release();
    }
    console.log(`[EASTCHAIN] Genesis reset ${resetBatchId}: ledger wiped, supply_buckets.minted reset to 0`);

    // ── 3. Zero out chain-derived columns on identity.users ───────────
    // (username, keys, self_custody_pubkey, tier, referral graph, etc. untouched)
    await identityPool.query(`
      UPDATE identity.users
      SET balance = 0, staked_amount = 0, stake_locked_until = 0, total_referral_bonus = 0, updated_at = NOW();
    `);

    // ── 4. Restore balances via REAL on-chain GENESIS_RESTORE tx ──────
    // Founders are deliberately EXCLUDED — their allocation now comes
    // exclusively from the fresh vesting schedule set up in step 6, not
    // from whatever balance they happened to hold before the reset. Their
    // snapshot row still exists (for audit purposes) but `restored` stays
    // false forever for them.
    let blocksCreated = 0;
    let usersRestored = 0;
    const toRestore = snapshots.filter(s => Number(s.balance) > 0 && !FOUNDER_IDS.includes(s.telegram_id));
    const foundersExcluded = snapshots.filter(s => FOUNDER_IDS.includes(s.telegram_id)).length;

    for (let i = 0; i < toRestore.length; i += RESTORE_BATCH_SIZE) {
      const batch = toRestore.slice(i, i + RESTORE_BATCH_SIZE);

      const txs: PendingTx[] = batch.map((s) => {
        const txHash = generateTxHash('GENESIS_RESTORE', s.telegram_id);
        return {
          txHash,
          txType: 'GENESIS_RESTORE',
          senderAddress: SYSTEM_ADDRESS,
          recipientAddress: s.wallet_address,
          senderId: 'SYSTEM',
          recipientId: s.telegram_id,
          amount: Number(s.balance),
          gasFee: 0,
          payload: { resetBatchId },
          commitFn: async () => {
            await identityPool.query(
              `UPDATE identity.users SET balance = balance + $1, updated_at = NOW() WHERE telegram_id = $2`,
              [Number(s.balance), s.telegram_id]
            );
            await identityPool.query(
              `UPDATE identity.genesis_reset_snapshots
               SET restored = TRUE, restored_at = NOW(), restore_tx_hash = $1
               WHERE reset_batch_id = $2 AND telegram_id = $3`,
              [txHash, resetBatchId, s.telegram_id]
            );
          },
          rollbackFn: async () => {
            console.error(`[EASTCHAIN] Genesis restore FAILED for ${s.telegram_id} (tx ${txHash}) — needs manual reconciliation from snapshot batch ${resetBatchId}`);
          },
        };
      });

      const result = await sealBlock(txs, false);
      if (!result.success) {
        console.error(`[EASTCHAIN] Genesis reset ${resetBatchId}: restore batch failed sealing:`, result.error);
        return {
          success: false,
          resetBatchId,
          usersSnapshotted: snapshots.length,
          usersRestored,
          blocksCreated,
          error: `Restore batch failed at block ${blocksCreated}: ${result.error}. Remaining users can be re-run from the snapshot (reset_batch_id=${resetBatchId}, restored=false).`,
        };
      }
      blocksCreated++;
      usersRestored += batch.length;
      console.log(`[EASTCHAIN] Genesis reset ${resetBatchId}: restore block #${result.blockIndex} sealed (${batch.length} user(s))`);
    }

    // ── 5. Restore staking positions directly (not a transfer, so not a tx) ──
    // ── 5. Restore staking positions directly (not a transfer, so not a tx) ──
    const stakedToRestore = snapshots.filter(s => Number(s.staked_amount) > 0 && !FOUNDER_IDS.includes(s.telegram_id));
    for (const s of stakedToRestore) {
      await identityPool.query(
        `UPDATE identity.users SET staked_amount = $1, stake_locked_until = $2, updated_at = NOW() WHERE telegram_id = $3`,
        [Number(s.staked_amount), Number(s.stake_locked_until), s.telegram_id]
      );
    }

    // ── 6. Reset founder vesting to the new schedule (12-month cliff,
    // then monthly for 36 more months — 48 total). This always REPLACES
    // progress, even if a schedule already existed and was partway
    // through — a genesis reset is a fresh start for the founder
    // allocation too, not just user balances.
    const vestingStart = new Date();
    const vestingFirstUnlock = new Date(vestingStart);
    vestingFirstUnlock.setMonth(vestingFirstUnlock.getMonth() + FOUNDER_VESTING_CLIFF_MONTHS);
    await identityPool.query(`
      UPDATE identity.vesting SET
        total_amount = $1,
        unlocked_amount = 0,
        monthly_release = $2,
        start_date = $3,
        next_unlock = $4,
        months_released = 0,
        total_months = $5,
        cliff_months = $6,
        is_completed = FALSE
    `, [
      FOUNDER_VESTING_TOTAL,
      FOUNDER_VESTING_TOTAL / FOUNDER_VESTING_RELEASE_MONTHS,
      vestingStart.toISOString(),
      vestingFirstUnlock.toISOString(),
      FOUNDER_VESTING_RELEASE_MONTHS,
      FOUNDER_VESTING_CLIFF_MONTHS,
    ]);
    console.log(`[EASTCHAIN] Genesis reset ${resetBatchId}: founder vesting reset — ${FOUNDER_VESTING_CLIFF_MONTHS}mo cliff, then ${FOUNDER_VESTING_RELEASE_MONTHS}mo of releases, first claimable ${vestingFirstUnlock.toISOString()}`);

    console.log(`[EASTCHAIN] Genesis reset ${resetBatchId} COMPLETE: ${usersRestored}/${toRestore.length} balance(s) restored across ${blocksCreated} block(s), ${stakedToRestore.length} stake(s) restored, ${foundersExcluded} founder(s) excluded from restore`);

    return {
      success: true,
      resetBatchId,
      usersSnapshotted: snapshots.length,
      usersRestored,
      blocksCreated,
    };
  } catch (err: any) {
    console.error(`[EASTCHAIN] Genesis reset ${resetBatchId} FAILED:`, err);
    return { success: false, resetBatchId, error: err.message };
  }
}
