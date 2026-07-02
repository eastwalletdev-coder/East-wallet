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
