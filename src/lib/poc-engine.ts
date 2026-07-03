/**
 * EASTCHAIN — Proof of Contribution (PoC) Engine
 * 
 * Validator Score = (Stake × 0.4) + (Uptime × 0.35) + (Reputation × 0.25)
 * - Stake    : staked_amount normalized against max staker
 * - Uptime   : last_active within 24h + claim_count in last 7 days
 * - Reputation: claim_count all-time normalized
 * 
 * Runs every 24h epoch via instrumentation.ts
 * Top N scores → active validators (N = TOP_VALIDATORS, default 3 for now)
 */

import { identityPool } from '@/lib/db/identity';
import { ledgerPool } from '@/lib/db/ledger';

const EPOCH_MS = 24 * 60 * 60 * 1000; // 24 hours

// Number of active validators elected each epoch. Set to 3 for now
// (early testnet phase) — bump VALIDATOR_COUNT in env when ready to scale.
export const TOP_VALIDATORS = Number(process.env.VALIDATOR_COUNT) || 3;

// Quorum for recovery votes / consensus actions: simple 2/3 majority,
// rounded up. With 3 validators that's 2/3.
export const VALIDATOR_QUORUM = Math.ceil((TOP_VALIDATORS * 2) / 3);

// Weights
const W_STAKE = 0.4;
const W_UPTIME = 0.35;
const W_REPUTATION = 0.25;

export async function runEpoch(): Promise<void> {
  const identityClient = await identityPool.connect();
  const ledgerClient = await ledgerPool.connect();

  try {
    console.log('[EASTCHAIN PoC] Running epoch scoring...');

    const now = Date.now();
    const sevenDaysAgo = new Date(now - 7 * EPOCH_MS).toISOString();
    const oneDayAgo = new Date(now - EPOCH_MS).toISOString();

    // Get all users with staking — identity DB only, no cross-database joins.
    const usersRes = await identityClient.query(`
      SELECT
        u.telegram_id,
        u.wallet_address,
        u.staked_amount,
        u.last_active,
        u.eastpass_tier
      FROM identity.users u
      WHERE u.staked_amount > 0
    `);

    if (usersRes.rows.length === 0) {
      console.log('[EASTCHAIN PoC] No staking users found, epoch skipped');
      return;
    }

    // Claims data lives in the ledger DB (separate Postgres/Neon project from
    // identity), so `ledger.transactions` is NOT reachable from identityClient
    // — that cross-database subquery was the bug that silently broke every
    // epoch run. Fetch aggregated claim counts here instead, then merge in JS.
    const claimsRes = await ledgerClient.query(`
      SELECT
        recipient_id,
        COUNT(*) FILTER (WHERE created_at > $1) as claims_7d,
        COUNT(*) as claims_total
      FROM ledger.transactions
      WHERE tx_type = 'MINING'
      GROUP BY recipient_id
    `, [sevenDaysAgo]);

    const claimsByUser = new Map<string, { claims7d: number; claimsTotal: number }>();
    for (const row of claimsRes.rows) {
      claimsByUser.set(row.recipient_id, {
        claims7d: Number(row.claims_7d),
        claimsTotal: Number(row.claims_total),
      });
    }

    const usersWithClaims = usersRes.rows.map((r: any) => {
      const c = claimsByUser.get(r.telegram_id);
      return {
        ...r,
        claims_7d: c?.claims7d ?? 0,
        claims_total: c?.claimsTotal ?? 0,
      };
    });

    // Find max values for normalization
    const maxStake = Math.max(...usersWithClaims.map((r: any) => Number(r.staked_amount)));
    const maxClaims7d = Math.max(...usersWithClaims.map((r: any) => Number(r.claims_7d)));
    const maxClaimsTotal = Math.max(...usersWithClaims.map((r: any) => Number(r.claims_total)));

    // Calculate PoC score for each user
    const scored = usersWithClaims.map((r: any) => {
      const stakeScore = maxStake > 0 ? Number(r.staked_amount) / maxStake : 0;

      // Uptime: combination of last_active (24h) + claims in 7 days
      const activeRecently = r.last_active
        ? new Date(r.last_active).getTime() > now - EPOCH_MS
        : false;
      const uptimeFromActive = activeRecently ? 0.5 : 0;
      const uptimeFromClaims = maxClaims7d > 0 ? (Number(r.claims_7d) / maxClaims7d) * 0.5 : 0;
      const uptimeScore = uptimeFromActive + uptimeFromClaims;

      // Reputation: all-time claim history
      const reputationScore = maxClaimsTotal > 0
        ? Number(r.claims_total) / maxClaimsTotal
        : 0;

      const totalScore =
        (stakeScore * W_STAKE) +
        (uptimeScore * W_UPTIME) +
        (reputationScore * W_REPUTATION);

      return {
        telegramId: r.telegram_id,
        walletAddress: r.wallet_address,
        stakeScore: Math.round(stakeScore * 100) / 100,
        uptimeScore: Math.round(uptimeScore * 100) / 100,
        reputationScore: Math.round(reputationScore * 100) / 100,
        totalScore: Math.round(totalScore * 10000) / 10000,
      };
    });

    // Sort by total score descending
    scored.sort((a: any, b: any) => b.totalScore - a.totalScore);
    const top10 = scored.slice(0, TOP_VALIDATORS);

    // Update validators table
    await identityClient.query('BEGIN');

    // Deactivate all current validators
    await identityClient.query(
      'UPDATE identity.validators SET is_active = FALSE, epoch_updated_at = NOW()'
    );

    // Upsert top N validators
    for (const v of top10) {
      await identityClient.query(`
        INSERT INTO identity.validators
          (telegram_id, wallet_address, stake_score, uptime_score, reputation_score, total_score, is_active, epoch_updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,TRUE,NOW())
        ON CONFLICT (telegram_id) DO UPDATE SET
          wallet_address = $2,
          stake_score = $3,
          uptime_score = $4,
          reputation_score = $5,
          total_score = $6,
          is_active = TRUE,
          epoch_updated_at = NOW()
      `, [v.telegramId, v.walletAddress, v.stakeScore, v.uptimeScore, v.reputationScore, v.totalScore]);
    }

    // Store epoch result in chain_meta
    await ledgerClient.query(`
      INSERT INTO ledger.chain_meta (key, value)
      VALUES ('last_epoch', $1)
      ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()
    `, [new Date(now).toISOString()]);

    await identityClient.query('COMMIT');

    console.log(`[EASTCHAIN PoC] Epoch complete — ${top10.length} validators elected`);
    top10.forEach((v: any, i: number) => {
      console.log(`  #${i + 1} ${v.telegramId} — score: ${v.totalScore}`);
    });

  } catch (err) {
    await identityClient.query('ROLLBACK').catch(() => {});
    console.error('[EASTCHAIN PoC] Epoch error:', err);
  } finally {
    identityClient.release();
    ledgerClient.release();
  }
}

// Check if user is eligible to mine (active in last 5 epochs)
export async function checkMiningEligibility(telegramId: string): Promise<{
  eligible: boolean;
  reason?: string;
  epochsActive: number;
}> {
  const fiveEpochsAgo = new Date(Date.now() - 5 * EPOCH_MS).toISOString();
  const client = await ledgerPool.connect();
  try {
    const res = await client.query(`
      SELECT COUNT(DISTINCT DATE(created_at)) as days_active
      FROM ledger.transactions
      WHERE recipient_id = $1
      AND tx_type = 'MINING'
      AND created_at > $2
    `, [telegramId, fiveEpochsAgo]);

    const epochsActive = Number(res.rows[0]?.days_active || 0);

    if (epochsActive === 0) {
      return {
        eligible: false,
        reason: 'Node inactive for 5+ epochs. Claim mining once to re-sync.',
        epochsActive,
      };
    }

    return { eligible: true, epochsActive };
  } finally {
    client.release();
  }
}

// Get current top validators
export async function getTopValidators(): Promise<any[]> {
  const client = await identityPool.connect();
  try {
    const res = await client.query(`
      SELECT v.*, u.username
      FROM identity.validators v
      LEFT JOIN identity.users u ON u.telegram_id = v.telegram_id
      WHERE v.is_active = TRUE
      ORDER BY v.total_score DESC
      LIMIT $1
    `, [TOP_VALIDATORS]);
    return res.rows;
  } finally {
    client.release();
  }
}
