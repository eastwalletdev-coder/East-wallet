'use server';

/**
 * EASTCHAIN Mining Actions
 * Direct-seal pattern: every tx immediately creates a block
 * No in-memory mempool — incompatible with Vercel serverless
 * Block-first atomic: block created before balance updates
 */

import { identityPool } from '@/lib/db/identity';
import { ledgerPool } from '@/lib/db/ledger';
import { getCachedUser, setCachedUser, invalidateCachedUser, setNetworkStatus } from '@/lib/db/redis';
import { generateWalletFromTelegramId } from '@/lib/blockchain';
import { getPublicKeyForUser } from '@/lib/keypair-service';
import { validateTelegramData, extractVerifiedUserId } from '@/lib/telegram';
import { computeBlockHash, computeSequenceHash, computeMerkleRoot, getActiveValidator } from '@/lib/block-engine';
import { publishBlockToRailway } from '@/lib/lightnode-publisher';
import { generateEastId } from '@/lib/east-id';
import { stakeEastContract, claimMiningRewardContract, claimVestedContract } from '@/actions/contract-actions';
import crypto from 'crypto';

const FOUNDER_IDS = (process.env.FOUNDER_IDS || '').split(',').map(id => id.trim()).filter(Boolean);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const SYSTEM_ADDRESS = '0x0000000000000000000000000000000000000000';
const STAKING_POOL_ADDRESS = '0x0000000000000000000000000000000000000001';

function generateTxHash(type: string, id: string): string {
  return '0x' + crypto.createHash('sha256')
    .update(`${type}_${id}_${Date.now()}_${Math.random()}`)
    .digest('hex');
}

// ─── Get last block ───────────────────────────────────────────────
async function getLastBlock(client: any): Promise<{ blockIndex: number; blockHash: string; sequenceHash: string }> {
  const res = await client.query(
    'SELECT block_index, block_hash, sequence_hash FROM ledger.blocks ORDER BY chain_seq DESC LIMIT 1'
  );
  if (!res.rows.length) return { blockIndex: -1, blockHash: 'GENESIS', sequenceHash: 'GENESIS' };
  return {
    blockIndex: res.rows[0].block_index,
    blockHash: res.rows[0].block_hash,
    sequenceHash: res.rows[0].sequence_hash,
  };
}

// ─── Direct seal: 1 tx = 1 block immediately ─────────────────────
// No batch window — Vercel serverless cannot maintain in-memory state
async function sealSingleTx(
  ledgerClient: any,
  tx: {
    txHash: string;
    txType: string;
    senderAddress: string;
    recipientAddress: string;
    senderId: string;
    recipientId: string;
    amount: number;
    gasFee?: number;
  }
): Promise<{ blockIndex: number; blockHash: string; sequenceHash: string }> {
  const { blockIndex: lastIndex, blockHash: prevHash } = await getLastBlock(ledgerClient);
  const blockIndex = lastIndex + 1;
  const timestamp = Date.now();

  const merkleRoot = computeMerkleRoot([tx.txHash]);
  const sequenceHash = computeSequenceHash(prevHash, blockIndex, timestamp);
  const blockHash = computeBlockHash(prevHash, blockIndex, merkleRoot, timestamp, 1);
  // System auto-assigns the current top-ranked validator to this block —
  // no manual validator signature needed, mirrors real blockchain behavior.
  const validatorId = await getActiveValidator();

  // Create block
  await ledgerClient.query(`
    INSERT INTO ledger.blocks
      (block_index, block_hash, prev_hash, sequence_hash, merkle_root,
       tx_count, total_gas, is_empty, validator_id)
    VALUES ($1,$2,$3,$4,$5,1,$6,FALSE,$7)
  `, [blockIndex, blockHash, prevHash, sequenceHash, merkleRoot, tx.gasFee || 0, validatorId]);

  publishBlockToRailway({
    height: blockIndex, hash: blockHash, previousHash: prevHash, merkleRoot,
    validator: validatorId, timestamp, epoch: Math.floor(timestamp / 86_400_000),
  });

  // Insert transaction
  await ledgerClient.query(`
    INSERT INTO ledger.transactions
      (tx_hash, block_index, tx_type, sender_address, recipient_address,
       sender_id, recipient_id, amount, gas_fee, status)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'confirmed')
  `, [tx.txHash, blockIndex, tx.txType, tx.senderAddress, tx.recipientAddress,
      tx.senderId, tx.recipientId, tx.amount, tx.gasFee || 0]);

  // Update chain meta
  await ledgerClient.query(`
    INSERT INTO ledger.chain_meta (key, value)
    VALUES ('lastBlockHash', $1) ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()
  `, [blockHash]);

  // Set genesis on first block
  if (blockIndex === 0) {
    await ledgerClient.query(`
      INSERT INTO ledger.chain_meta (key, value)
      VALUES ('genesis_timestamp', $1) ON CONFLICT (key) DO NOTHING
    `, [new Date(timestamp).toISOString()]);
    console.log(`[EASTCHAIN] Genesis block created at ${new Date(timestamp).toISOString()}`);
  }

  // Publish block to Telegram Channel (Emergency Ledger)
  // Non-blocking — channel publish failure does not affect chain
  setImmediate(async () => {
    try {
      const { publishBlockToChannel } = await import('@/lib/gossip');
      await publishBlockToChannel({
        blockIndex,
        blockHash,
        prevHash,
        minerAddress: tx.senderAddress,
        txType: tx.txType,
        amount: tx.amount,
        timestamp,
      });
    } catch { /* non-fatal */ }
  });

  return { blockIndex, blockHash, sequenceHash };
}

// ─── Register / Update User ───────────────────────────────────────
export async function registerOrUpdateUser(
  telegramId: string, username: string, initData?: string, startParam?: string
) {
  if (IS_PRODUCTION) {
    if (!initData || !validateTelegramData(initData)) {
      return { success: false, error: 'IDENTITY_VIOLATION' };
    }
    const verifiedId = extractVerifiedUserId(initData);
    if (!verifiedId || verifiedId !== telegramId) return { success: false, error: 'IDENTITY_MISMATCH' };
  }

  const walletAddress = generateWalletFromTelegramId(telegramId);
  const isFounder = FOUNDER_IDS.includes(telegramId);
  const eastId = generateEastId(walletAddress);

  // ── Level 1: Redis cache read (< 50ms) ──────────────────────────
  // For returning users with no startParam, serve from cache immediately
  // while background-syncing to Postgres. publicKeyHex is NOT computed
  // here on purpose — BIP-39 derivation (PBKDF2, 2048 rounds) is real
  // CPU work and this path exists specifically to stay fast.
  if (!startParam) {
    const cached = await getCachedUser(telegramId);
    if (cached) {
      // Background sync to Postgres without blocking response
      const client = await identityPool.connect();
      client.query(
        `UPDATE identity.users SET username = $1, updated_at = NOW() WHERE telegram_id = $2`,
        [username, telegramId]
      ).catch(() => {}).finally(() => client.release());

      return {
        success: true,
        user: cached,
        referralLink: `https://t.me/${process.env.NEXT_PUBLIC_BOT_USERNAME || 'Eastwallet_bot'}?start=${telegramId}`,
        fromCache: true,
      };
    }
  }

  // Only reached on cache miss / first visit / referral flow — safe to
  // pay the BIP-39 derivation cost here, it's not on the hot path.
  const { publicKeyHex } = await getPublicKeyForUser(telegramId);

  // ── Level 2: Full Postgres flow for new users / referrals ───────
  const client = await identityPool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      INSERT INTO identity.users (telegram_id, wallet_address, username, is_founder, public_key)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (telegram_id) DO UPDATE
        SET username = $3, updated_at = NOW(),
            is_founder = identity.users.is_founder OR $4,
            public_key = COALESCE(identity.users.public_key, $5)
    `, [telegramId, walletAddress, username, isFounder, publicKeyHex]);

    // Auto-register referral from Telegram deep link start_param
    if (startParam && startParam !== telegramId) {
      const userRow = await client.query(
        'SELECT referred_by FROM identity.users WHERE telegram_id = $1', [telegramId]
      );
      if (!userRow.rows[0]?.referred_by) {
        const refExists = await client.query(
          'SELECT telegram_id FROM identity.users WHERE telegram_id = $1', [startParam]
        );
        if (refExists.rows.length > 0) {
          await client.query(
            'UPDATE identity.users SET referred_by = $1 WHERE telegram_id = $2',
            [startParam, telegramId]
          );
          await client.query(`
            INSERT INTO identity.referrals (referrer_id, referred_id)
            VALUES ($1, $2) ON CONFLICT (referred_id) DO NOTHING
          `, [startParam, telegramId]);
        }
      }
    }

    const userRes = await client.query(
      'SELECT * FROM identity.users WHERE telegram_id = $1', [telegramId]
    );
    await client.query('COMMIT');

    const user = userRes.rows[0];
    const userData = {
      telegramId: user.telegram_id,
      walletAddress: user.wallet_address,
      eastId,
      username: user.username,
      balance: Number(user.balance),
      stakedAmount: Number(user.staked_amount),
      eastpassTier: Number(user.eastpass_tier),
      isFounder: user.is_founder,
      referredBy: user.referred_by,
      totalReferralBonus: Number(user.total_referral_bonus),
    };

    // ── Cache for next visit ───────────────────────────────────────
    await setCachedUser(telegramId, userData);

    return {
      success: true,
      user: userData,
      referralLink: `https://t.me/${process.env.NEXT_PUBLIC_BOT_USERNAME || 'Eastwallet_bot'}?start=${telegramId}`,
    };
  } catch (err: any) {
    await client.query('ROLLBACK');
    return { success: false, error: err.message };
  } finally {
    client.release();
  }
}

// ─── Claim Mining Reward ──────────────────────────────────────────
// Now runs through lib/contracts/engine.ts (CONTRACTS.MINING/claimMiningReward):
// gas-metered in EAST, signed + nonce-protected, recorded in
// ledger.contract_calls in addition to the usual block/transaction.
// Business logic itself lives in lib/contracts/mining-contract.ts.
export async function claimMiningReward(tgId: string, initData?: string) {
  const res = await claimMiningRewardContract(tgId, initData);
  if (!res.success) return { success: false, error: res.error, remainingSeconds: (res as any).remainingSeconds };
  return {
    success: true,
    txHash: res.txHash,
    blockIndex: res.blockIndex,
    blockHash: res.blockHash,
    sequenceHash: res.sequenceHash,
    reward: res.reward,
    gasFee: res.gasFee,
    callHash: res.callHash,
  };
}

// ─── Send EAST ────────────────────────────────────────────────────
export async function sendEast(senderTgId: string, recipientAddress: string, amount: number, initData?: string) {
  if (IS_PRODUCTION) {
    if (!initData || !validateTelegramData(initData)) return { success: false, error: 'IDENTITY_VIOLATION' };

    // Cross-check: senderTgId must match the verified identity inside initData
    // (prevents spoofing senderTgId while using your own valid initData)
    const verifiedId = extractVerifiedUserId(initData);
    if (!verifiedId || verifiedId !== senderTgId) {
      return { success: false, error: 'IDENTITY_MISMATCH' };
    }
  }
  if (amount <= 0) return { success: false, error: 'INVALID_AMOUNT' };

  const identityClient = await identityPool.connect();
  const ledgerClient = await ledgerPool.connect();

  try {
    await identityClient.query('BEGIN');
    await ledgerClient.query('BEGIN');

    const senderRes = await identityClient.query(
      'SELECT * FROM identity.users WHERE telegram_id = $1 FOR UPDATE', [senderTgId]
    );
    if (!senderRes.rows.length) throw new Error('SENDER_NOT_FOUND');
    const sender = senderRes.rows[0];
    if (Number(sender.balance) < amount) throw new Error('INSUFFICIENT_BALANCE');

    const recipientRes = await identityClient.query(
      'SELECT * FROM identity.users WHERE wallet_address = $1 FOR UPDATE', [recipientAddress.toLowerCase()]
    );
    if (!recipientRes.rows.length) throw new Error('RECIPIENT_NOT_FOUND');
    const recipient = recipientRes.rows[0];
    if (recipient.telegram_id === senderTgId) throw new Error('CANNOT_SEND_TO_SELF');

    const txHash = generateTxHash('transfer', senderTgId);

    // Block first
    const { blockIndex, blockHash } = await sealSingleTx(ledgerClient, {
      txHash,
      txType: 'TRANSFER',
      senderAddress: sender.wallet_address,
      recipientAddress,
      senderId: senderTgId,
      recipientId: recipient.telegram_id,
      amount,
      gasFee: 0,
    });

    await ledgerClient.query('COMMIT');

    // Balances after block confirmed
    await identityClient.query(
      'UPDATE identity.users SET balance = balance - $1, updated_at = NOW() WHERE telegram_id = $2',
      [amount, senderTgId]
    );
    await identityClient.query(
      'UPDATE identity.users SET balance = balance + $1, updated_at = NOW() WHERE telegram_id = $2',
      [amount, recipient.telegram_id]
    );

    await identityClient.query('COMMIT');
    await Promise.all([
      invalidateCachedUser(senderTgId),
      invalidateCachedUser(recipient.telegram_id),
    ]);
    return { success: true, txHash, blockIndex, blockHash };
  } catch (err: any) {
    await identityClient.query('ROLLBACK').catch(() => {});
    await ledgerClient.query('ROLLBACK').catch(() => {});
    return { success: false, error: err.message };
  } finally {
    identityClient.release();
    ledgerClient.release();
  }
}

// ─── Stake EAST ───────────────────────────────────────────────────
// Now runs through lib/contracts/engine.ts (CONTRACTS.STAKING/stake):
// gas-metered in EAST, signed + nonce-protected. Business logic lives in
// lib/contracts/staking-contract.ts. Return shape kept identical to the
// pre-engine version (proofHash/lockedUntil/blockIndex/blockHash) so the
// existing EastPass UI needs no changes.
export async function stakeEast(tgId: string, amount: number, initData?: string) {
  if (amount <= 0) return { success: false, error: 'INVALID_AMOUNT' };
  const res = await stakeEastContract(tgId, amount, initData);
  if (!res.success) return { success: false, error: res.error };
  return {
    success: true,
    proofHash: res.txHash,
    lockedUntil: res.lockedUntil,
    blockIndex: res.blockIndex,
    blockHash: res.blockHash,
    gasFee: res.gasFee,
    callHash: res.callHash,
  };
}

// ─── Network management ───────────────────────────────────────────
export async function initiateConsensusRecovery(telegramId: string, initData?: string) {
  if (IS_PRODUCTION) {
    if (!initData || !validateTelegramData(initData)) {
      return { success: false, error: 'IDENTITY_VIOLATION' };
    }
    const verifiedId = extractVerifiedUserId(initData);
    if (!verifiedId || verifiedId !== telegramId) {
      return { success: false, error: 'IDENTITY_MISMATCH' };
    }
    if (!FOUNDER_IDS.includes(telegramId)) {
      return { success: false, error: 'FOUNDER_ONLY' };
    }
  }
  try {
    await setNetworkStatus('active');
    return { success: true, resumedAt: Date.now() };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function performRollingArchive(maxIndex: number, telegramId: string, initData?: string) {
  if (IS_PRODUCTION) {
    if (!initData || !validateTelegramData(initData)) {
      return { success: false, error: 'IDENTITY_VIOLATION' };
    }
    const verifiedId = extractVerifiedUserId(initData);
    if (!verifiedId || verifiedId !== telegramId) {
      return { success: false, error: 'IDENTITY_MISMATCH' };
    }
    if (!FOUNDER_IDS.includes(telegramId)) {
      return { success: false, error: 'FOUNDER_ONLY' };
    }
  }
  const identityClient = await identityPool.connect();
  const ledgerClient = await ledgerPool.connect();
  try {
    await ledgerClient.query('BEGIN');
    await identityClient.query('BEGIN');

    const blocksToArchive = await ledgerClient.query(
      'SELECT * FROM ledger.blocks WHERE block_index <= $1 ORDER BY block_index ASC',
      [maxIndex]
    );
    if (blocksToArchive.rows.length === 0) {
      await ledgerClient.query('ROLLBACK');
      await identityClient.query('ROLLBACK');
      return { success: true, count: 0 };
    }

    for (const block of blocksToArchive.rows) {
      const txs = await ledgerClient.query(
        'SELECT * FROM ledger.transactions WHERE block_index = $1', [block.block_index]
      );
      await identityClient.query(`
        INSERT INTO identity.archive_blocks
          (chain_seq, block_index, block_hash, prev_hash, miner_address, reward, block_data)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT DO NOTHING
      `, [block.chain_seq, block.block_index, block.block_hash, block.prev_hash,
          block.validator_id || 'system', block.total_gas, JSON.stringify(txs.rows)]);
    }

    const last = blocksToArchive.rows[blocksToArchive.rows.length - 1];
    await ledgerClient.query(`
      INSERT INTO ledger.checkpoints (pruned_index, hash_at_pruned, sequence_hash_at_pruned)
      VALUES ($1,$2,$3)
    `, [last.block_index, last.block_hash, last.sequence_hash]);

    await ledgerClient.query('COMMIT');
    await identityClient.query('COMMIT');
    return { success: true, count: blocksToArchive.rows.length };
  } catch (err: any) {
    await ledgerClient.query('ROLLBACK').catch(() => {});
    await identityClient.query('ROLLBACK').catch(() => {});
    return { success: false, error: err.message };
  } finally {
    identityClient.release();
    ledgerClient.release();
  }
}

// ─── Chain state & Explorer ───────────────────────────────────────
export async function getChainState() {
  const ledgerClient = await ledgerPool.connect();
  try {
    const lastBlock = await ledgerClient.query(
      'SELECT block_index, block_hash, sequence_hash FROM ledger.blocks ORDER BY chain_seq DESC LIMIT 1'
    );
    const supplyRes = await ledgerClient.query(
      'SELECT bucket, cap, minted FROM ledger.supply_buckets'
    );
    const checkpointRes = await ledgerClient.query(
      'SELECT pruned_index FROM ledger.checkpoints ORDER BY id DESC LIMIT 1'
    );
    const genesisRes = await ledgerClient.query(
      "SELECT value FROM ledger.chain_meta WHERE key = 'genesis_timestamp'"
    );
    const { getNetworkStatus } = await import('@/lib/db/redis');
    const networkStatus = await getNetworkStatus();

    const buckets: Record<string, any> = {};
    let totalMinted = 0;
    for (const row of supplyRes.rows) {
      buckets[row.bucket] = { cap: Number(row.cap), minted: Number(row.minted) };
      totalMinted += Number(row.minted);
    }

    return {
      blockCount: lastBlock.rows[0]?.block_index ?? -1,
      lastBlockHash: lastBlock.rows[0]?.block_hash || 'GENESIS_WAITING',
      lastSequenceHash: lastBlock.rows[0]?.sequence_hash || null,
      totalMinted,
      totalCap: 1_000_000_000,
      buckets,
      lastPrunedIndex: checkpointRes.rows[0]?.pruned_index ?? -1,
      genesis: genesisRes.rows[0]?.value || null,
      status: networkStatus,
    };
  } finally {
    ledgerClient.release();
  }
}

export async function getRecentBlocks(limitCount = 10) {
  const client = await ledgerPool.connect();
  try {
    const res = await client.query(`
      SELECT b.*,
        (SELECT COUNT(*) FROM ledger.transactions t WHERE t.block_index = b.block_index) as actual_tx_count,
        (SELECT t.tx_type FROM ledger.transactions t WHERE t.block_index = b.block_index ORDER BY t.created_at ASC LIMIT 1) as tx_type
      FROM ledger.blocks b
      ORDER BY b.chain_seq DESC LIMIT $1
    `, [limitCount]);
    return res.rows;
  } finally {
    client.release();
  }
}

export async function searchExplorer(query: string) {
  const client = await ledgerPool.connect();
  const identityClient = await identityPool.connect();
  try {
    const q = query.trim();

    // Block hash or tx hash
    if (q.startsWith('0x') && q.length > 10) {
      const blockRes = await client.query(
        'SELECT * FROM ledger.blocks WHERE block_hash ILIKE $1 OR sequence_hash ILIKE $1 LIMIT 1',
        [`${q}%`]
      );
      if (blockRes.rows.length > 0) {
        const block = blockRes.rows[0];
        const txs = await client.query(
          'SELECT * FROM ledger.transactions WHERE block_index = $1 ORDER BY created_at ASC',
          [block.block_index]
        );
        return { type: 'block', block, transactions: txs.rows };
      }

      const txRes = await client.query(
        'SELECT * FROM ledger.transactions WHERE tx_hash ILIKE $1 LIMIT 1', [`${q}%`]
      );
      if (txRes.rows.length > 0) {
        const tx = txRes.rows[0];
        const block = await client.query(
          'SELECT * FROM ledger.blocks WHERE block_index = $1', [tx.block_index]
        );
        return { type: 'transaction', transaction: tx, block: block.rows[0] };
      }

      // Wallet address
      const addrTxs = await client.query(`
        SELECT * FROM ledger.transactions
        WHERE sender_address ILIKE $1 OR recipient_address ILIKE $1
        ORDER BY created_at DESC LIMIT 20
      `, [`${q}%`]);
      if (addrTxs.rows.length > 0) {
        const userInfo = await identityClient.query(
          'SELECT telegram_id, username, balance FROM identity.users WHERE wallet_address ILIKE $1',
          [`${q}%`]
        );
        return { type: 'address', address: q, transactions: addrTxs.rows, user: userInfo.rows[0] || null };
      }
    }

    // EAST ID
    if (q.toUpperCase().startsWith('EAST-')) {
      const { generateEastId } = await import('@/lib/east-id');
      const usersRes = await identityClient.query('SELECT * FROM identity.users LIMIT 1000');
      const match = usersRes.rows.find((u: any) => generateEastId(u.wallet_address) === q.toUpperCase());
      if (match) {
        const txs = await client.query(`
          SELECT * FROM ledger.transactions
          WHERE sender_address = $1 OR recipient_address = $1
          ORDER BY created_at DESC LIMIT 20
        `, [match.wallet_address]);
        return { type: 'eastid', address: match.wallet_address, transactions: txs.rows, user: match };
      }
    }

    // Block index
    const blockIndex = parseInt(q.replace('#', ''));
    if (!isNaN(blockIndex)) {
      const blockRes = await client.query(
        'SELECT * FROM ledger.blocks WHERE block_index = $1', [blockIndex]
      );
      if (blockRes.rows.length > 0) {
        const txs = await client.query(
          'SELECT * FROM ledger.transactions WHERE block_index = $1 ORDER BY created_at ASC',
          [blockIndex]
        );
        return { type: 'block', block: blockRes.rows[0], transactions: txs.rows };
      }
    }

    return { type: 'not_found', query: q };
  } finally {
    client.release();
    identityClient.release();
  }
}

// ─── PoC & Validator ─────────────────────────────────────────────
export async function getValidators() {
  const { getTopValidators } = await import('@/lib/poc-engine');
  return getTopValidators();
}

export async function submitConsensusVote(
  telegramId: string,
  vote: 'approve' | 'reject',
  initData?: string
) {
  if (IS_PRODUCTION) {
    if (!initData || !validateTelegramData(initData)) return { success: false, error: 'IDENTITY_VIOLATION' };
  }

  const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || ''}/api/consensus`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ telegramId, vote, initData }),
  });
  return res.json();
}

export async function checkEligibility(telegramId: string) {
  const { checkMiningEligibility } = await import('@/lib/poc-engine');
  return checkMiningEligibility(telegramId);
}

// ─── Audit Trail — Founder only ────────────────────────────────────
// Returns mint_log + current supply_buckets state.
// Access restricted: telegramId must be in FOUNDER_IDS AND match the
// HMAC-verified identity inside initData (prevents ID spoofing).
export async function getAuditTrail(telegramId: string, initData?: string) {
  if (IS_PRODUCTION) {
    if (!initData || !validateTelegramData(initData)) {
      return { success: false, error: 'IDENTITY_VIOLATION' };
    }
    const verifiedId = extractVerifiedUserId(initData);
    if (!verifiedId || verifiedId !== telegramId) {
      return { success: false, error: 'IDENTITY_MISMATCH' };
    }
  }

  if (!FOUNDER_IDS.includes(telegramId)) {
    return { success: false, error: 'FOUNDER_ONLY' };
  }

  const client = await ledgerPool.connect();
  try {
    const bucketsRes = await client.query(
      'SELECT bucket, cap, minted, updated_at FROM ledger.supply_buckets ORDER BY bucket'
    );
    const logRes = await client.query(
      'SELECT bucket, amount, reason, triggered_by, created_at FROM ledger.mint_log ORDER BY created_at DESC LIMIT 100'
    );
    return {
      success: true,
      buckets: bucketsRes.rows,
      mintLog: logRes.rows,
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  } finally {
    client.release();
  }
}

// ─── Block Detail — fetch block + all transactions by block_index ──
export async function getBlockDetail(blockIndex: number) {
  const client = await ledgerPool.connect();
  try {
    const blockRes = await client.query(
      'SELECT * FROM ledger.blocks WHERE block_index = $1 LIMIT 1',
      [blockIndex]
    );
    if (!blockRes.rows.length) return { success: false, error: 'BLOCK_NOT_FOUND' };

    const txRes = await client.query(
      `SELECT tx_hash, tx_type, sender_address, recipient_address,
              sender_id, recipient_id, amount, gas_fee, status, created_at
       FROM ledger.transactions
       WHERE block_index = $1
       ORDER BY created_at ASC`,
      [blockIndex]
    );

    return {
      success: true,
      block: blockRes.rows[0],
      transactions: txRes.rows,
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  } finally {
    client.release();
  }
}

// ─── Vesting claim (founder allocation) ─────────────────────────────
// New capability — previously /api/vesting was read-only. Runs through
// lib/contracts/engine.ts (CONTRACTS.VESTING/claimVested); founder-only
// gating is enforced both in vesting-contract.ts and here.
export async function claimVestedTokens(tgId: string, initData?: string) {
  if (IS_PRODUCTION) {
    if (!initData || !validateTelegramData(initData)) return { success: false, error: 'IDENTITY_VIOLATION' };
    const verifiedId = extractVerifiedUserId(initData);
    if (!verifiedId || verifiedId !== tgId) return { success: false, error: 'IDENTITY_MISMATCH' };
    if (!FOUNDER_IDS.includes(tgId)) return { success: false, error: 'FOUNDER_ONLY' };
  }
  return claimVestedContract(tgId, initData);
}
