/**
 * EASTCHAIN — Identity Database (Schema: identity)
 * NeonDB Pool A — users, validators, referrals, archive
 */
import { Pool } from 'pg';
import { getPublicKeyForUser } from '@/lib/keypair-service';

const identityPool = new Pool({
  connectionString: process.env.DATABASE_IDENTITY_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
});

export { identityPool };

export async function initIdentitySchema() {
  const client = await identityPool.connect();
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS identity;`);

    // Users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS identity.users (
        telegram_id VARCHAR(50) PRIMARY KEY,
        wallet_address VARCHAR(42) UNIQUE NOT NULL,
        username VARCHAR(150) DEFAULT '',
        balance DOUBLE PRECISION DEFAULT 0.0,
        staked_amount DOUBLE PRECISION DEFAULT 0.0,
        eastpass_tier INT DEFAULT 0,
        stake_locked_until BIGINT DEFAULT 0,
        last_active BIGINT DEFAULT 0,
        is_founder BOOLEAN DEFAULT FALSE,
        referred_by VARCHAR(50) DEFAULT '',
        total_referral_bonus DOUBLE PRECISION DEFAULT 0.0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Referrals table
    await client.query(`
      CREATE TABLE IF NOT EXISTS identity.referrals (
        id SERIAL PRIMARY KEY,
        referrer_id VARCHAR(50) NOT NULL,
        referred_id VARCHAR(50) NOT NULL UNIQUE,
        bonus_paid BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Validators table
    await client.query(`
      CREATE TABLE IF NOT EXISTS identity.validators (
        telegram_id VARCHAR(50) PRIMARY KEY,
        wallet_address VARCHAR(42) NOT NULL,
        stake_score DOUBLE PRECISION DEFAULT 0,
        uptime_score DOUBLE PRECISION DEFAULT 0,
        reputation_score DOUBLE PRECISION DEFAULT 0,
        total_score DOUBLE PRECISION DEFAULT 0,
        is_active BOOLEAN DEFAULT TRUE,
        epoch_updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Consensus votes table
    await client.query(`
      CREATE TABLE IF NOT EXISTS identity.consensus_votes (
        id SERIAL PRIMARY KEY,
        round_id VARCHAR(100) NOT NULL,
        voter_id VARCHAR(50) NOT NULL,
        vote VARCHAR(20) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(round_id, voter_id)
      );
    `);

    // Archive blocks (cold storage — blocks > 30 days from ledger)
    await client.query(`
      CREATE TABLE IF NOT EXISTS identity.archive_blocks (
        chain_seq BIGINT NOT NULL,
        block_index INT NOT NULL,
        block_hash VARCHAR(66) NOT NULL,
        prev_hash VARCHAR(66) NOT NULL,
        miner_address VARCHAR(42) NOT NULL,
        reward DOUBLE PRECISION NOT NULL,
        block_data JSONB DEFAULT '{}',
        archived_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_archive_index ON identity.archive_blocks(block_index);`);

    console.log('[EASTCHAIN] Identity schema initialized');
  } finally {
    client.release();
  }
}

// Migration: add chain_seq + vesting table if missing from old schema
export async function migrateIdentityV2() {
  const client = await identityPool.connect();
  try {
    // Add chain_seq to archive_blocks if missing
    await client.query(`ALTER TABLE identity.archive_blocks ADD COLUMN IF NOT EXISTS chain_seq BIGINT NOT NULL DEFAULT 0;`);

    // Vesting table (for founder vesting UI)
    await client.query(`
      CREATE TABLE IF NOT EXISTS identity.vesting (
        id              SERIAL PRIMARY KEY,
        label           VARCHAR(100) NOT NULL DEFAULT 'Founder Allocation',
        total_amount    DOUBLE PRECISION NOT NULL DEFAULT 50000000,
        unlocked_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
        monthly_release DOUBLE PRECISION NOT NULL DEFAULT 0,
        start_date      TIMESTAMPTZ DEFAULT NULL,
        next_unlock     TIMESTAMPTZ DEFAULT NULL,
        months_released INT NOT NULL DEFAULT 0,
        total_months    INT NOT NULL DEFAULT 12,
        is_completed    BOOLEAN NOT NULL DEFAULT FALSE,
        created_at      TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    console.log('[EASTCHAIN] Identity schema migration v2 completed');
  } catch (err) {
    console.error('[EASTCHAIN] Identity migration error (non-fatal):', err);
  } finally {
    client.release();
  }
}

// ─── Migration v3: real Ed25519 public keys for every user ──────────────
// public_key is derived deterministically from telegram_id (see
// keypair-service.ts), so this column can always be recomputed — it's a
// cache, not a secret. Safe to re-run.
export async function migrateIdentityV3() {
  const client = await identityPool.connect();
  try {
    await client.query(`ALTER TABLE identity.users ADD COLUMN IF NOT EXISTS public_key VARCHAR(64) DEFAULT NULL;`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_public_key ON identity.users(public_key);`);
    console.log('[EASTCHAIN] Identity schema migration v3 completed (public_key column)');
  } catch (err) {
    console.error('[EASTCHAIN] Identity migration v3 error (non-fatal):', err);
  } finally {
    client.release();
  }
}

// ─── Migration v4: reset stale public_key values after switching to ─────
// BIP-39/44 derivation (see keypair-service.ts). The old public_key
// values were derived directly from a raw HMAC seed; the new scheme
// derives them via a BIP-39 mnemonic + BIP-44 path, so they no longer
// match. Guarded by schema_flags so this destructive-looking reset only
// ever runs once, even across many server restarts.
export async function migrateIdentityV4() {
  const client = await identityPool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS identity.schema_flags (
        flag TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const { rows } = await client.query(
      `SELECT 1 FROM identity.schema_flags WHERE flag = 'v4_bip39_keypair_reset'`
    );

    if (rows.length === 0) {
      await client.query(`UPDATE identity.users SET public_key = NULL WHERE public_key IS NOT NULL;`);
      await client.query(
        `INSERT INTO identity.schema_flags (flag) VALUES ('v4_bip39_keypair_reset') ON CONFLICT DO NOTHING;`
      );
      console.log('[EASTCHAIN] Identity migration v4 — reset public_key for BIP-39/44 backfill');
    }
  } catch (err) {
    console.error('[EASTCHAIN] Identity migration v4 error (non-fatal):', err);
  } finally {
    client.release();
  }
}

// ─── Migration v5: external-wallet linking column (contract engine) ─────
// Nullable, unused until a "link my MetaMask" flow is built. Reserved so
// that lib/contracts/engine.ts can verify an EVM signature's recovered
// address against a value ONLY the server ever wrote here — never a
// client-supplied "trust me, this is my address" claim. Until a linking
// flow exists, the external-wallet call path in the engine simply always
// rejects (linked_evm_address is NULL), which is the safe default.
export async function migrateIdentityV5() {
  const client = await identityPool.connect();
  try {
    await client.query(`ALTER TABLE identity.users ADD COLUMN IF NOT EXISTS linked_evm_address VARCHAR(42) DEFAULT NULL;`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_users_linked_evm ON identity.users(linked_evm_address);`);
    console.log('[EASTCHAIN] Identity schema migration v5 completed (linked_evm_address column)');
  } catch (err) {
    console.error('[EASTCHAIN] Identity migration v5 error (non-fatal):', err);
  } finally {
    client.release();
  }
}

// ─── Migration v6: first-claim gas waiver flag ───────────────────────
// New users have balance = 0 and can't yet pay gas for their very first
// mining claim — this flag lets the engine waive gas exactly once per
// user, only for CONTRACTS.MINING/claimMiningReward, then flips to TRUE
// forever (no way to "reset" it back to unclaimed).
export async function migrateIdentityV6() {
  const client = await identityPool.connect();
  try {
    await client.query(`ALTER TABLE identity.users ADD COLUMN IF NOT EXISTS has_first_claimed BOOLEAN NOT NULL DEFAULT FALSE;`);
    console.log('[EASTCHAIN] Identity schema migration v6 completed (has_first_claimed column)');
  } catch (err) {
    console.error('[EASTCHAIN] Identity migration v6 error (non-fatal):', err);
  } finally {
    client.release();
  }
}

/**
 * Migration v7: authoritative, race-proof mining cooldown + a claim
 * timestamp for staking rewards that isn't shared with anything else.
 *
 * Two separate bugs, same root cause (reusing a general-purpose field
 * as a specific authoritative check):
 *  - Redis (checkClaimCooldown) was the ONLY thing enforcing the 24h
 *    mining claim limit — a check-then-act gap between the Redis check
 *    and the actual mint, plus Redis failing OPEN if misconfigured,
 *    meant a user could double-claim by firing concurrent requests.
 *    `last_mining_claim_at` is checked + updated inside the same
 *    row-locked (FOR UPDATE) DB transaction as the mint, so it can't
 *    be raced — Redis stays only as a fast pre-check for UX.
 *  - claimStakingReward used `last_active` as its "time since last
 *    claim" reference — but `last_active` is also bumped by mining
 *    claims and by stake() itself, so any mining claim silently reset
 *    the staking-reward clock, systematically underpaying active
 *    miners. `last_staking_claim_at` is dedicated to this one purpose.
 */
export async function migrateIdentityV7() {
  const client = await identityPool.connect();
  try {
    await client.query(`ALTER TABLE identity.users ADD COLUMN IF NOT EXISTS last_mining_claim_at BIGINT NOT NULL DEFAULT 0;`);
    await client.query(`ALTER TABLE identity.users ADD COLUMN IF NOT EXISTS last_staking_claim_at BIGINT NOT NULL DEFAULT 0;`);
    console.log('[EASTCHAIN] Identity schema migration v7 completed (last_mining_claim_at, last_staking_claim_at columns)');
  } catch (err) {
    console.error('[EASTCHAIN] Identity migration v7 error (non-fatal):', err);
  } finally {
    client.release();
  }
}

/**
 * Migration v8 — self-custody + validator candidacy.
 *
 * Adds:
 *  - identity.users.self_custody_pubkey / self_custody_migrated_at — a
 *    pubkey the USER generated and holds themselves (client-side), proven
 *    via a signature over a claim message signed with their existing
 *    server-derived key. Separate from the custodial keypair-service.ts
 *    keys, which the server can still derive on its own.
 *  - identity.validator_candidates — an admin-reviewed intake queue for
 *    validator applications. Deliberately NOT auto-approved: this project
 *    is federated/permissioned at this stage, not permissionless, and the
 *    schema should be honest about that rather than implying otherwise.
 *
 * See src/lib/db/migrations/002_self_custody.sql for the raw SQL if you'd
 * rather run it directly with psql instead of via this function.
 */
export async function migrateIdentityV8() {
  const client = await identityPool.connect();
  try {
    await client.query(`ALTER TABLE identity.users ADD COLUMN IF NOT EXISTS self_custody_pubkey VARCHAR(128);`);
    await client.query(`ALTER TABLE identity.users ADD COLUMN IF NOT EXISTS self_custody_migrated_at TIMESTAMPTZ;`);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_self_custody_pubkey
        ON identity.users (self_custody_pubkey)
        WHERE self_custody_pubkey IS NOT NULL;
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS identity.validator_candidates (
        telegram_id VARCHAR(50) PRIMARY KEY REFERENCES identity.users(telegram_id),
        public_key VARCHAR(128) NOT NULL,
        signature VARCHAR(256) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending_review',
        submitted_at TIMESTAMPTZ DEFAULT NOW(),
        reviewed_at TIMESTAMPTZ,
        reviewed_by VARCHAR(50),
        notes TEXT DEFAULT ''
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_validator_candidates_status ON identity.validator_candidates (status);`);
    console.log('[EASTCHAIN] Identity schema migration v8 completed (self-custody + validator_candidates)');
  } catch (err) {
    console.error('[EASTCHAIN] Identity migration v8 error (non-fatal):', err);
  } finally {
    client.release();
  }
}

/**
 * Migration v9 — real node liveness tracking, distinct from PoC score.
 *
 * `identity.validators` is elected purely by runEpoch()'s scoring (stake +
 * uptime + reputation from app activity) — it says nothing about whether a
 * validator is actually running independent node software. These columns
 * add that missing signal:
 *   - node_type: 'internal_vercel' (default — no separate node, Vercel
 *     produces on their behalf, exactly like today) or 'external' (they run
 *     their own always-on process that heartbeats in).
 *   - last_heartbeat_at: updated by /api/node/heartbeat. A validator only
 *     counts toward the "2+ active external nodes" leader-proposal
 *     threshold if this is recent — being scored highly is not enough on
 *     its own.
 */
export async function migrateIdentityV9() {
  const client = await identityPool.connect();
  try {
    await client.query(`ALTER TABLE identity.validators ADD COLUMN IF NOT EXISTS node_type VARCHAR(20) NOT NULL DEFAULT 'internal_vercel';`);
    await client.query(`ALTER TABLE identity.validators ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ;`);
    console.log('[EASTCHAIN] Identity schema migration v9 completed (node_type, last_heartbeat_at on validators)');
  } catch (err) {
    console.error('[EASTCHAIN] Identity migration v9 error (non-fatal):', err);
  } finally {
    client.release();
  }
}

/**
 * Migration v10: identity.genesis_reset_snapshots — backup table used by
 * POST /api/admin/genesis-reset. Every user's balance/stake is snapshotted
 * here BEFORE the chain is wiped, then automatically restored via real
 * on-chain GENESIS_RESTORE transactions on the new chain (see
 * src/actions/genesis-reset-actions.ts) — never a silent UPDATE, so the
 * restoration itself is auditable in ledger.transactions.
 */
export async function migrateIdentityV10() {
  const client = await identityPool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS identity.genesis_reset_snapshots (
        id                    SERIAL PRIMARY KEY,
        reset_batch_id        UUID NOT NULL,
        telegram_id           VARCHAR(50) NOT NULL,
        wallet_address        VARCHAR(42) NOT NULL,
        balance               DOUBLE PRECISION NOT NULL DEFAULT 0,
        staked_amount         DOUBLE PRECISION NOT NULL DEFAULT 0,
        stake_locked_until    BIGINT NOT NULL DEFAULT 0,
        total_referral_bonus  DOUBLE PRECISION NOT NULL DEFAULT 0,
        snapshotted_at        TIMESTAMPTZ DEFAULT NOW(),
        restored              BOOLEAN NOT NULL DEFAULT FALSE,
        restored_at           TIMESTAMPTZ,
        restore_tx_hash       VARCHAR(66)
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_genesis_snapshots_batch ON identity.genesis_reset_snapshots(reset_batch_id);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_genesis_snapshots_restored ON identity.genesis_reset_snapshots(restored);`);
    console.log('[EASTCHAIN] Identity schema migration v10 completed (genesis_reset_snapshots)');
  } catch (err) {
    console.error('[EASTCHAIN] Identity migration v10 error (non-fatal):', err);
  } finally {
    client.release();
  }
}

/**
 * Migration v11: identity.admin_audit_log — persistent record of
 * destructive/sensitive admin actions (currently just genesis-reset).
 * console.warn alone isn't enough for forensics since Vercel logs are
 * ephemeral/rotate — this survives.
 */
export async function migrateIdentityV11() {
  const client = await identityPool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS identity.admin_audit_log (
        id            SERIAL PRIMARY KEY,
        action        VARCHAR(50) NOT NULL,
        performed_by  VARCHAR(50) NOT NULL,
        detail        JSONB,
        performed_at  TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('[EASTCHAIN] Identity schema migration v11 completed (admin_audit_log)');
  } catch (err) {
    console.error('[EASTCHAIN] Identity migration v11 error (non-fatal):', err);
  } finally {
    client.release();
  }
}

/** How recent a heartbeat must be to count as "actually online" right now. */
export const HEARTBEAT_FRESHNESS_SECONDS = 90;

/**
 * Records a heartbeat from an external validator node. Caller MUST verify
 * the signature before calling this — see /api/node/heartbeat/route.ts.
 * Also flips node_type to 'external' the first time, since a heartbeat is
 * proof the caller is running independent node software.
 */
export async function recordValidatorHeartbeat(telegramId: string): Promise<void> {
  const client = await identityPool.connect();
  try {
    await client.query(
      `UPDATE identity.validators
       SET node_type = 'external', last_heartbeat_at = NOW()
       WHERE telegram_id = $1`,
      [telegramId]
    );
  } finally {
    client.release();
  }
}

/**
 * Active external validators right now — is_active (won this epoch's
 * scoring) AND node_type='external' AND heartbeat fresh. This is the list
 * leader-schedule.ts picks from and counts against the "2+" threshold.
 */
export async function getActiveExternalValidators(): Promise<Array<{
  telegramId: string;
  selfCustodyPubkey: string | null;
  totalScore: number;
}>> {
  const client = await identityPool.connect();
  try {
    const res = await client.query(
      `SELECT v.telegram_id, v.total_score, u.self_custody_pubkey
       FROM identity.validators v
       JOIN identity.users u ON u.telegram_id = v.telegram_id
       WHERE v.is_active = TRUE
         AND v.node_type = 'external'
         AND v.last_heartbeat_at > NOW() - INTERVAL '${HEARTBEAT_FRESHNESS_SECONDS} seconds'
         AND u.self_custody_pubkey IS NOT NULL
       ORDER BY v.telegram_id ASC` // stable order — deterministic leader picking needs this
    );
    return res.rows.map((r: any) => ({
      telegramId: r.telegram_id,
      selfCustodyPubkey: r.self_custody_pubkey,
      totalScore: Number(r.total_score),
    }));
  } finally {
    client.release();
  }
}

/**
 * Records that a user has taken control of their own keypair. Call only
 * after verifying the accompanying signature (see self-custody-actions.ts)
 * — this function itself does not verify anything, it just persists.
 */
export async function setSelfCustodyPubkey(telegramId: string, pubkeyHex: string) {
  const client = await identityPool.connect();
  try {
    await client.query(
      `UPDATE identity.users
       SET self_custody_pubkey = $1, self_custody_migrated_at = NOW(), updated_at = NOW()
       WHERE telegram_id = $2`,
      [pubkeyHex, telegramId]
    );
  } finally {
    client.release();
  }
}

export async function getSelfCustodyStatus(telegramId: string): Promise<{
  selfCustodyPubkey: string | null;
  migratedAt: string | null;
}> {
  const client = await identityPool.connect();
  try {
    const res = await client.query(
      `SELECT self_custody_pubkey, self_custody_migrated_at FROM identity.users WHERE telegram_id = $1`,
      [telegramId]
    );
    if (res.rows.length === 0) return { selfCustodyPubkey: null, migratedAt: null };
    return {
      selfCustodyPubkey: res.rows[0].self_custody_pubkey,
      migratedAt: res.rows[0].self_custody_migrated_at,
    };
  } finally {
    client.release();
  }
}

/**
 * Insert (or resubmit) a validator candidacy application. Always lands as
 * 'pending_review' — admin approval happens separately (see
 * reviewValidatorCandidate). Resubmitting overwrites a prior rejected/
 * pending application but never touches an already-approved one.
 */
export async function submitValidatorCandidate(
  telegramId: string,
  pubkeyHex: string,
  signatureHex: string
): Promise<{ success: true } | { success: false; error: string }> {
  const client = await identityPool.connect();
  try {
    const existing = await client.query(
      `SELECT status FROM identity.validator_candidates WHERE telegram_id = $1`,
      [telegramId]
    );
    if (existing.rows.length > 0 && existing.rows[0].status === 'approved') {
      return { success: false, error: 'ALREADY_APPROVED' };
    }
    await client.query(
      `INSERT INTO identity.validator_candidates (telegram_id, public_key, signature, status, submitted_at)
       VALUES ($1, $2, $3, 'pending_review', NOW())
       ON CONFLICT (telegram_id)
       DO UPDATE SET public_key = $2, signature = $3, status = 'pending_review',
                      submitted_at = NOW(), reviewed_at = NULL, reviewed_by = NULL`,
      [telegramId, pubkeyHex, signatureHex]
    );
    return { success: true };
  } finally {
    client.release();
  }
}

export async function listValidatorCandidates(status?: string) {
  const client = await identityPool.connect();
  try {
    const res = status
      ? await client.query(`SELECT * FROM identity.validator_candidates WHERE status = $1 ORDER BY submitted_at ASC`, [status])
      : await client.query(`SELECT * FROM identity.validator_candidates ORDER BY submitted_at ASC`);
    return res.rows;
  } finally {
    client.release();
  }
}

/**
 * Admin action — approve or reject a pending candidate. This is the
 * manual gate: with a handful of trusted users, review is a deliberate
 * choice rather than a limitation to route around.
 */
export async function reviewValidatorCandidate(
  telegramId: string,
  decision: 'approved' | 'rejected',
  reviewedBy: string,
  notes = ''
) {
  const client = await identityPool.connect();
  try {
    await client.query(
      `UPDATE identity.validator_candidates
       SET status = $1, reviewed_at = NOW(), reviewed_by = $2, notes = $3
       WHERE telegram_id = $4`,
      [decision, reviewedBy, notes, telegramId]
    );
  } finally {
    client.release();
  }
}

/**
 * Backfill public_key for every existing user that doesn't have one yet
 * (old users created before the keypair system existed). Also usable to
 * (re)generate a keypair for a single user by id.
 *
 * Safe to call repeatedly — it's idempotent (same userId -> same keypair).
 */
export async function backfillKeypairs(onlyTelegramId?: string): Promise<{ updated: number; total: number }> {
  const client = await identityPool.connect();
  try {
    const res = await client.query(
      onlyTelegramId
        ? `SELECT telegram_id FROM identity.users WHERE telegram_id = $1`
        : `SELECT telegram_id FROM identity.users WHERE public_key IS NULL`,
      onlyTelegramId ? [onlyTelegramId] : []
    );

    let updated = 0;
    for (const row of res.rows) {
      const { publicKeyHex } = await getPublicKeyForUser(row.telegram_id);
      await client.query(
        `UPDATE identity.users SET public_key = $1, updated_at = NOW() WHERE telegram_id = $2`,
        [publicKeyHex, row.telegram_id]
      );
      updated++;
    }

    return { updated, total: res.rows.length };
  } finally {
    client.release();
  }
}

/**
 * Claim message builders live in src/lib/east-claim-messages.ts — a plain
 * isomorphic module importable from client components too (needed so the
 * browser can sign the exact same string this server verifies against).
 * Re-exported here for convenience so existing callers of identity.ts
 * don't need a second import.
 */
export { buildSelfCustodyClaimMessage, buildValidatorClaimMessage } from '@/lib/east-claim-messages';
