/**
 * EASTCHAIN — Ledger Database (Schema: ledger)
 * NeonDB Pool B — blocks, transactions, supply, chain meta, staking
 */
import { Pool } from 'pg';

const ledgerPool = new Pool({
  connectionString: process.env.DATABASE_LEDGER_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
});

export { ledgerPool };

export async function initLedgerSchema() {
  const client = await ledgerPool.connect();
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS ledger;`);

    // Chain meta
    await client.query(`
      CREATE TABLE IF NOT EXISTS ledger.chain_meta (
        key VARCHAR(100) PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Supply buckets
    await client.query(`
      CREATE TABLE IF NOT EXISTS ledger.supply_buckets (
        bucket VARCHAR(50) PRIMARY KEY,
        cap DOUBLE PRECISION NOT NULL,
        minted DOUBLE PRECISION DEFAULT 0.0,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    const buckets = [
      // Whitepaper exact: total = 1,000,000,000 EAST
      // Mining & Community 65% = 650M split into 4 sub-buckets:
      ['mining',    400_000_000], // Mobile Mining Rewards
      ['staking',   100_000_000], // EAST PASS APY & Staking
      ['validator', 100_000_000], // Mobile Validator Rewards (reserved)
      ['campaign',   50_000_000], // Community Campaigns + Referral bonuses
      // Remaining 35%:
      ['liquidity', 100_000_000], // Liquidity Pool (reserved)
      ['treasury',  100_000_000], // Treasury & Ecosystem Reserve
      ['founder',    50_000_000], // Founder Allocation (vesting)
      ['marketing',  50_000_000], // Marketing & Growth
      ['team',       50_000_000], // Team & Development
      // Total: 400+100+100+50+100+100+50+50+50 = 1,000,000,000 ✓
    ];
    for (const [bucket, cap] of buckets) {
      await client.query(`
        INSERT INTO ledger.supply_buckets (bucket, cap)
        VALUES ($1, $2) ON CONFLICT (bucket) DO UPDATE SET cap = $2
      `, [bucket, cap]);
    }

    // Blocks table — supports batch tx + VSH + empty blocks
    await client.query(`
      CREATE TABLE IF NOT EXISTS ledger.blocks (
        chain_seq     BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        block_index   INT NOT NULL,
        block_hash    VARCHAR(66) UNIQUE NOT NULL,
        prev_hash     VARCHAR(66) NOT NULL DEFAULT 'GENESIS',
        sequence_hash VARCHAR(66) NOT NULL,
        merkle_root   VARCHAR(66) DEFAULT NULL,
        tx_count      INT NOT NULL DEFAULT 0,
        total_gas     DOUBLE PRECISION NOT NULL DEFAULT 0,
        is_empty      BOOLEAN NOT NULL DEFAULT FALSE,
        validator_id  VARCHAR(50) DEFAULT NULL,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_blocks_index ON ledger.blocks(block_index DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_blocks_hash ON ledger.blocks(block_hash);`);

    // ledger.transactions, saga_log, mempool created in migrateSchemaV2 (runs after init)

    // Checkpoints
    await client.query(`
      CREATE TABLE IF NOT EXISTS ledger.checkpoints (
        id SERIAL PRIMARY KEY,
        pruned_index INT NOT NULL,
        hash_at_pruned VARCHAR(66) NOT NULL,
        sequence_hash_at_pruned VARCHAR(66) NOT NULL,
        archived_to VARCHAR(500) DEFAULT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Staking positions
    await client.query(`
      CREATE TABLE IF NOT EXISTS ledger.staking_positions (
        id SERIAL PRIMARY KEY,
        telegram_id VARCHAR(50) NOT NULL,
        amount DOUBLE PRECISION NOT NULL,
        locked_until BIGINT NOT NULL,
        stake_hash VARCHAR(66) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Mint audit log — records every mintFromBucket call for transparency
    await client.query(`
      CREATE TABLE IF NOT EXISTS ledger.mint_log (
        id SERIAL PRIMARY KEY,
        bucket VARCHAR(50) NOT NULL,
        amount DOUBLE PRECISION NOT NULL,
        reason VARCHAR(100) NOT NULL DEFAULT 'unspecified',
        triggered_by VARCHAR(50) NOT NULL DEFAULT 'system',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_mint_log_bucket ON ledger.mint_log(bucket);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_mint_log_created ON ledger.mint_log(created_at DESC);`);

    // mempool created in migrateSchemaV2

    console.log('[EASTCHAIN] Ledger schema v2 initialized');
  } finally {
    client.release();
  }
}

// Mint from supply bucket — atomic, with audit log
export async function mintFromBucket(
  client: any, bucket: string, amount: number,
  reason: string = 'unspecified', triggeredBy: string = 'system'
): Promise<{ ok: boolean; reason?: string }> {
  const res = await client.query(
    'SELECT cap, minted FROM ledger.supply_buckets WHERE bucket = $1 FOR UPDATE',
    [bucket]
  );
  if (!res.rows.length) return { ok: false, reason: `Unknown bucket: ${bucket}` };
  const { cap, minted } = res.rows[0];
  if (Number(minted) + amount > Number(cap)) return { ok: false, reason: `Bucket "${bucket}" exhausted` };
  await client.query(
    'UPDATE ledger.supply_buckets SET minted = minted + $1, updated_at = NOW() WHERE bucket = $2',
    [amount, bucket]
  );
  await client.query(
    'INSERT INTO ledger.mint_log (bucket, amount, reason, triggered_by) VALUES ($1, $2, $3, $4)',
    [bucket, amount, reason, triggeredBy]
  );
  return { ok: true };
}

// ─── Migration v3: contract engine tables (staking/vesting/mining/validator "contracts") ──
export async function migrateContractSchema() {
  const client = await ledgerPool.connect();
  try {
    // Per-address nonce, used by lib/contracts/engine.ts to make every signed
    // contract call replay-proof (a captured signature can only ever be used once).
    await client.query(`
      CREATE TABLE IF NOT EXISTS ledger.contract_nonces (
        address VARCHAR(42) PRIMARY KEY,
        nonce   BIGINT NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Audit log of every contract call (separate from ledger.transactions,
    // which only records the resulting token movement, if any).
    await client.query(`
      CREATE TABLE IF NOT EXISTS ledger.contract_calls (
        id SERIAL PRIMARY KEY,
        call_hash        VARCHAR(66) UNIQUE NOT NULL,
        contract_address VARCHAR(42) NOT NULL,
        function_name    VARCHAR(50) NOT NULL,
        calldata         JSONB NOT NULL DEFAULT '{}',
        caller_address   VARCHAR(42) NOT NULL,
        nonce            BIGINT NOT NULL,
        gas_fee          DOUBLE PRECISION NOT NULL DEFAULT 0,
        status           VARCHAR(20) NOT NULL DEFAULT 'confirmed',
        created_at       TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_contract_calls_caller ON ledger.contract_calls(caller_address);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_contract_calls_contract ON ledger.contract_calls(contract_address);`);

    // Default gas price (EAST per contract call) — governance-adjustable later
    // without redeploying, since the engine reads this at call time.
    await client.query(`
      INSERT INTO ledger.chain_meta (key, value) VALUES ('gas_price_east', '0.01')
      ON CONFLICT (key) DO NOTHING
    `);

    console.log('[EASTCHAIN] Contract engine schema initialized (contract_calls, contract_nonces)');
  } catch (err) {
    console.error('[EASTCHAIN] Contract schema migration error (non-fatal):', err);
  } finally {
    client.release();
  }
}

// ─── Migration: upgrade old schema to v2 without data loss ───────────────────
export async function migrateSchemaV2() {
  const client = await ledgerPool.connect();
  try {
    // Upgrade old blocks schema
    await client.query(`ALTER TABLE ledger.blocks ADD COLUMN IF NOT EXISTS sequence_hash VARCHAR(66) DEFAULT '0x0';`);
    await client.query(`ALTER TABLE ledger.blocks ADD COLUMN IF NOT EXISTS merkle_root VARCHAR(66) DEFAULT NULL;`);
    await client.query(`ALTER TABLE ledger.blocks ADD COLUMN IF NOT EXISTS tx_count INT NOT NULL DEFAULT 0;`);
    await client.query(`ALTER TABLE ledger.blocks ADD COLUMN IF NOT EXISTS total_gas DOUBLE PRECISION NOT NULL DEFAULT 0;`);
    await client.query(`ALTER TABLE ledger.blocks ADD COLUMN IF NOT EXISTS is_empty BOOLEAN NOT NULL DEFAULT FALSE;`);
    await client.query(`ALTER TABLE ledger.blocks ADD COLUMN IF NOT EXISTS validator_id VARCHAR(50) DEFAULT NULL;`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_blocks_hash ON ledger.blocks(block_hash);`);

    // Fix wrong buckets from old schema
    // Remove referral bucket (not in whitepaper)
    await client.query(`DELETE FROM ledger.supply_buckets WHERE bucket = 'referral';`);
    // Remove wrong mining=650M (split into sub-buckets)
    // Keep existing if already correct
    const correctBuckets: [string, number][] = [
      ['mining', 400_000_000], ['staking', 100_000_000],
      ['validator', 100_000_000], ['campaign', 50_000_000],
      ['liquidity', 100_000_000], ['treasury', 100_000_000],
      ['founder', 50_000_000], ['marketing', 50_000_000], ['team', 50_000_000],
    ];
    for (const [bucket, cap] of correctBuckets) {
      await client.query(`
        INSERT INTO ledger.supply_buckets (bucket, cap)
        VALUES ($1, $2) ON CONFLICT (bucket) DO UPDATE SET cap = $2
      `, [bucket, cap]);
    }

    // Create transactions table if missing
    await client.query(`
      CREATE TABLE IF NOT EXISTS ledger.transactions (
        tx_hash           VARCHAR(66) PRIMARY KEY,
        block_index       INT NOT NULL,
        tx_type           VARCHAR(50) NOT NULL,
        sender_address    VARCHAR(42) NOT NULL,
        recipient_address VARCHAR(42) NOT NULL,
        sender_id         VARCHAR(50) NOT NULL DEFAULT 'system',
        recipient_id      VARCHAR(50) NOT NULL DEFAULT 'system',
        amount            DOUBLE PRECISION NOT NULL DEFAULT 0,
        gas_fee           DOUBLE PRECISION NOT NULL DEFAULT 0,
        status            VARCHAR(20) NOT NULL DEFAULT 'confirmed',
        created_at        TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_tx_block ON ledger.transactions(block_index DESC);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_tx_sender ON ledger.transactions(sender_address);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_tx_recipient ON ledger.transactions(recipient_address);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_tx_hash ON ledger.transactions(tx_hash);`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ledger.saga_log (
        id SERIAL PRIMARY KEY, tx_hash VARCHAR(66) NOT NULL,
        step VARCHAR(50) NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'completed',
        error TEXT DEFAULT NULL, created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await client.query(`ALTER TABLE ledger.checkpoints ADD COLUMN IF NOT EXISTS sequence_hash_at_pruned VARCHAR(66) DEFAULT NULL;`);

    console.log('[EASTCHAIN] Ledger schema migration v2 completed — supply buckets corrected');
  } catch (err) {
    console.error('[EASTCHAIN] Ledger migration error (non-fatal):', err);
  } finally {
    client.release();
  }
}

/**
 * Migration v3 — block proposals for leader-proposal mode.
 *
 * Vercel keeps assembling and hashing every block itself (that part is NOT
 * decentralized by this migration — see leader-schedule.ts for the honest
 * scope of what changes). What changes is WHO gets credited/authorized as
 * the block's producer once 2+ external validator nodes are active:
 * instead of always self-producing, Vercel creates a proposal assigning the
 * slot to the elected leader, waits up to a short deadline for that node to
 * countersign, and only falls back to self-producing if the deadline passes
 * unclaimed — chosen deliberately so the chain never stalls on one offline
 * node.
 */
export async function migrateLedgerV3() {
  const client = await ledgerPool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ledger.block_proposals (
        id               SERIAL PRIMARY KEY,
        block_index      INT NOT NULL,
        assigned_telegram_id VARCHAR(50) NOT NULL,
        assigned_pubkey  VARCHAR(128) NOT NULL,
        tx_hashes        JSONB NOT NULL DEFAULT '[]',
        is_empty         BOOLEAN NOT NULL DEFAULT FALSE,
        deadline_at      TIMESTAMPTZ NOT NULL,
        status           VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | submitted | fallback_sealed | expired
        sealed_block_index INT DEFAULT NULL,
        created_at       TIMESTAMPTZ DEFAULT NOW(),
        resolved_at      TIMESTAMPTZ
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_block_proposals_status ON ledger.block_proposals(status);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_block_proposals_deadline ON ledger.block_proposals(deadline_at);`);
    console.log('[EASTCHAIN] Ledger schema migration v3 completed (block_proposals table)');
  } catch (err) {
    console.error('[EASTCHAIN] Ledger migration v3 error (non-fatal):', err);
  } finally {
    client.release();
  }
}

/**
 * Migration v4: adds columns needed for REAL external block production
 * (as opposed to v3's credit-only attestation). The external node now
 * computes and submits blockHash/merkleRoot/sequenceHash itself; Vercel
 * recomputes independently from the same trusted inputs (prev_hash +
 * tx_hashes it already has) and only accepts the submission if every
 * value matches — see leader-schedule.ts's validateAndAcceptProduction().
 * reject_reason logs the specific mismatch for monitoring/fraud signals.
 */
export async function migrateLedgerV4() {
  const client = await ledgerPool.connect();
  try {
    await client.query(`ALTER TABLE ledger.block_proposals ADD COLUMN IF NOT EXISTS prev_hash VARCHAR(70);`);
    await client.query(`ALTER TABLE ledger.block_proposals ADD COLUMN IF NOT EXISTS submitted_block_hash VARCHAR(70);`);
    await client.query(`ALTER TABLE ledger.block_proposals ADD COLUMN IF NOT EXISTS submitted_merkle_root VARCHAR(70);`);
    await client.query(`ALTER TABLE ledger.block_proposals ADD COLUMN IF NOT EXISTS submitted_sequence_hash VARCHAR(70);`);
    await client.query(`ALTER TABLE ledger.block_proposals ADD COLUMN IF NOT EXISTS submitted_timestamp_ms BIGINT;`);
    await client.query(`ALTER TABLE ledger.block_proposals ADD COLUMN IF NOT EXISTS reject_reason TEXT;`);
    console.log('[EASTCHAIN] Ledger schema migration v4 completed (real block production columns on block_proposals)');
  } catch (err) {
    console.error('[EASTCHAIN] Ledger migration v4 error (non-fatal):', err);
  } finally {
    client.release();
  }
}

/**
 * Migration v5: ledger.mempool — was referenced by block-engine.ts's
 * addToMempool()/DELETE-on-seal but NEVER actually had a CREATE TABLE
 * anywhere (a pre-existing latent bug; harmless only because nothing
 * called addToMempool() for real traffic yet — every tx type sealed its
 * own 1-tx-1-block directly). Now used for real gas-priority batching —
 * see submitTransaction() in block-engine.ts.
 */
export async function migrateLedgerV5() {
  const client = await ledgerPool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ledger.mempool (
        tx_hash            VARCHAR(66) PRIMARY KEY,
        tx_type            VARCHAR(30) NOT NULL,
        sender_address     VARCHAR(42) NOT NULL,
        recipient_address  VARCHAR(42) NOT NULL,
        sender_id          VARCHAR(50) NOT NULL,
        recipient_id       VARCHAR(50) NOT NULL,
        amount             DOUBLE PRECISION NOT NULL,
        gas_fee            DOUBLE PRECISION NOT NULL DEFAULT 0,
        payload            JSONB,
        status             VARCHAR(20) NOT NULL DEFAULT 'pending',
        block_index        BIGINT,
        block_hash         VARCHAR(70),
        error               TEXT,
        submitted_at       TIMESTAMPTZ DEFAULT NOW(),
        sealed_at          TIMESTAMPTZ
      );
    `);
    // Gas-priority ordering: highest gas_fee first, oldest-first as tiebreak
    // (matches a real fee-market mempool — see selectBatchByGasPriority()).
    await client.query(`CREATE INDEX IF NOT EXISTS idx_mempool_priority ON ledger.mempool(status, gas_fee DESC, submitted_at ASC);`);
    console.log('[EASTCHAIN] Ledger schema migration v5 completed (ledger.mempool table + gas-priority index)');
  } catch (err) {
    console.error('[EASTCHAIN] Ledger migration v5 error (non-fatal):', err);
  } finally {
    client.release();
  }
}

/**
 * Migration v6 — R2 archive reconciliation log.
 * See src/lib/archive/reconcile.ts: every time a block's R2 copy doesn't
 * match (or doesn't exist), a row goes here — whether or not the self-heal
 * re-archive succeeded. This is the audit trail for that process.
 */
export async function migrateLedgerV6() {
  const client = await ledgerPool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS ledger.archive_discrepancies (
        id                SERIAL PRIMARY KEY,
        block_index       INT NOT NULL,
        discrepancy_type  VARCHAR(20) NOT NULL, -- 'missing_in_r2' | 'hash_mismatch'
        db_hash           VARCHAR(66) NOT NULL,
        r2_hash           VARCHAR(66),
        detected_at       TIMESTAMPTZ DEFAULT NOW(),
        healed_at         TIMESTAMPTZ,
        heal_result       VARCHAR(20) -- 'healed' | 'heal_failed'
      );
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_archive_discrepancies_height ON ledger.archive_discrepancies(block_index);`);
    console.log('[EASTCHAIN] Ledger schema migration v6 completed (ledger.archive_discrepancies table)');
  } catch (err) {
    console.error('[EASTCHAIN] Ledger migration v6 error (non-fatal):', err);
  } finally {
    client.release();
  }
}
