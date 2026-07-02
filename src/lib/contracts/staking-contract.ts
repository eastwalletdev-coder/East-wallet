/**
 * EASTCHAIN — Staking Contract (address: CONTRACTS.STAKING)
 * Runs inside an already-open identityClient/ledgerClient transaction
 * provided by the engine (engine.ts) — this module must NOT call
 * BEGIN/COMMIT/ROLLBACK itself.
 */
import { mintFromBucket } from '@/lib/db/ledger';
import { getTierFromStaked } from '@/lib/ledger';
import { computeBlockHash, computeSequenceHash, computeMerkleRoot } from '@/lib/block-engine';
import crypto from 'crypto';

const STAKING_POOL_ADDRESS = '0x0000000000000000000000000000000000000001';
const SYSTEM_ADDRESS = '0x0000000000000000000000000000000000000000';
const STAKE_LOCK_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const STAKING_APY = 0.08; // 8% simple APY, paid out pro-rata on claim

function txHash(seed: string): string {
  return '0x' + crypto.createHash('sha256').update(`${seed}_${Date.now()}_${Math.random()}`).digest('hex');
}

async function getLastBlock(ledgerClient: any) {
  const res = await ledgerClient.query(
    'SELECT block_index, block_hash FROM ledger.blocks ORDER BY chain_seq DESC LIMIT 1'
  );
  if (!res.rows.length) return { blockIndex: -1, blockHash: 'GENESIS' };
  return { blockIndex: res.rows[0].block_index, blockHash: res.rows[0].block_hash };
}

async function sealSingleTx(ledgerClient: any, tx: {
  txHash: string; txType: string; senderAddress: string; recipientAddress: string;
  senderId: string; recipientId: string; amount: number;
}) {
  const { blockIndex: lastIndex, blockHash: prevHash } = await getLastBlock(ledgerClient);
  const blockIndex = lastIndex + 1;
  const timestamp = Date.now();
  const merkleRoot = computeMerkleRoot([tx.txHash]);
  const sequenceHash = computeSequenceHash(prevHash, blockIndex, timestamp);
  const blockHash = computeBlockHash(prevHash, blockIndex, merkleRoot, timestamp, 1);

  await ledgerClient.query(`
    INSERT INTO ledger.blocks (block_index, block_hash, prev_hash, sequence_hash, merkle_root, tx_count, total_gas, is_empty, validator_id)
    VALUES ($1,$2,$3,$4,$5,1,0,FALSE,NULL)
  `, [blockIndex, blockHash, prevHash, sequenceHash, merkleRoot]);

  await ledgerClient.query(`
    INSERT INTO ledger.transactions (tx_hash, block_index, tx_type, sender_address, recipient_address, sender_id, recipient_id, amount, gas_fee, status)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,'confirmed')
  `, [tx.txHash, blockIndex, tx.txType, tx.senderAddress, tx.recipientAddress, tx.senderId, tx.recipientId, tx.amount]);

  return { blockIndex, blockHash };
}

export async function execute(
  functionName: string,
  params: Record<string, any>,
  ctx: { tgId: string; user: any; identityClient: any; ledgerClient: any }
): Promise<{ success: boolean; error?: string; data?: any }> {
  const { tgId, user, identityClient, ledgerClient } = ctx;

  if (functionName === 'stake') {
    const amount = Number(params.amount);
    if (!Number.isFinite(amount) || amount <= 0) return { success: false, error: 'INVALID_AMOUNT' };
    if (Number(user.balance) < amount) return { success: false, error: 'INSUFFICIENT_BALANCE' };

    const timestamp = Date.now();
    const lockedUntil = timestamp + STAKE_LOCK_MS;
    const newStaked = Number(user.staked_amount) + amount;
    const newTier = getTierFromStaked(newStaked);
    const hash = txHash(`stake_${tgId}`);

    const { blockIndex, blockHash } = await sealSingleTx(ledgerClient, {
      txHash: hash, txType: 'STAKE', senderAddress: user.wallet_address,
      recipientAddress: STAKING_POOL_ADDRESS, senderId: tgId, recipientId: 'staking_pool', amount,
    });

    await ledgerClient.query(`
      INSERT INTO ledger.staking_positions (telegram_id, amount, locked_until, stake_hash)
      VALUES ($1,$2,$3,$4)
    `, [tgId, amount, lockedUntil, hash]);

    await identityClient.query(`
      UPDATE identity.users SET balance = balance - $1, staked_amount = staked_amount + $1,
        eastpass_tier = $2, stake_locked_until = $3, last_active = $4, updated_at = NOW()
      WHERE telegram_id = $5
    `, [amount, newTier.level, lockedUntil, timestamp, tgId]);

    return { success: true, data: { txHash: hash, blockIndex, blockHash, lockedUntil } };
  }

  if (functionName === 'unstake') {
    const staked = Number(user.staked_amount);
    if (staked <= 0) return { success: false, error: 'NOTHING_STAKED' };
    if (Date.now() < Number(user.stake_locked_until || 0)) return { success: false, error: 'STILL_LOCKED' };

    const hash = txHash(`unstake_${tgId}`);
    const { blockIndex, blockHash } = await sealSingleTx(ledgerClient, {
      txHash: hash, txType: 'UNSTAKE', senderAddress: STAKING_POOL_ADDRESS,
      recipientAddress: user.wallet_address, senderId: 'staking_pool', recipientId: tgId, amount: staked,
    });

    await identityClient.query(`
      UPDATE identity.users SET balance = balance + $1, staked_amount = 0, eastpass_tier = 0,
        stake_locked_until = 0, updated_at = NOW()
      WHERE telegram_id = $2
    `, [staked, tgId]);

    return { success: true, data: { txHash: hash, blockIndex, blockHash, unstaked: staked } };
  }

  if (functionName === 'claimStakingReward') {
    const staked = Number(user.staked_amount);
    if (staked <= 0) return { success: false, error: 'NOTHING_STAKED' };

    // Simple pro-rata reward since last claim (or since stake began), capped daily.
    const lastClaim = Number(user.last_active || Date.now());
    const elapsedDays = Math.min(30, Math.max(0, (Date.now() - lastClaim) / 86_400_000));
    const reward = Math.round(staked * (STAKING_APY / 365) * elapsedDays * 100) / 100;
    if (reward <= 0) return { success: false, error: 'NOTHING_TO_CLAIM_YET' };

    const mint = await mintFromBucket(ledgerClient, 'staking', reward, 'staking_reward', tgId);
    if (!mint.ok) return { success: false, error: `STAKING_POOL_EXHAUSTED: ${mint.reason}` };

    const hash = txHash(`stakereward_${tgId}`);
    const { blockIndex, blockHash } = await sealSingleTx(ledgerClient, {
      txHash: hash, txType: 'STAKING_REWARD', senderAddress: SYSTEM_ADDRESS,
      recipientAddress: user.wallet_address, senderId: 'system', recipientId: tgId, amount: reward,
    });

    await identityClient.query(`
      UPDATE identity.users SET balance = balance + $1, last_active = $2, updated_at = NOW()
      WHERE telegram_id = $3
    `, [reward, Date.now(), tgId]);

    return { success: true, data: { txHash: hash, blockIndex, blockHash, reward } };
  }

  return { success: false, error: 'UNIMPLEMENTED_FUNCTION' };
}
