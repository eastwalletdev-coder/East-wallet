/**
 * EASTCHAIN — Staking Contract (address: CONTRACTS.STAKING)
 * Runs inside an already-open identityClient/ledgerClient transaction
 * provided by the engine (engine.ts) — this module must NOT call
 * BEGIN/COMMIT/ROLLBACK itself.
 */
import { mintFromBucket } from '@/lib/db/ledger';
import { getTierFromStaked } from '@/lib/ledger';
import { computeBlockHash, computeSequenceHash, computeMerkleRoot, getActiveValidator } from '@/lib/block-engine';
import { signChainHeader } from '@/lib/consensus/chain-signing';
import { resolveBlockProducer } from '@/lib/consensus/leader-schedule';
import { publishBlockToRailway } from '@/lib/lightnode-publisher';
import crypto from 'crypto';

const STAKING_POOL_ADDRESS = '0x0000000000000000000000000000000000000001';
const SYSTEM_ADDRESS = '0x0000000000000000000000000000000000000000';
const STAKE_LOCK_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — only used by the legacy tier-card 'unstake' function below
const UNSTAKE_CLAIM_DELAY_MS = 24 * 60 * 60 * 1000; // 24h — used by requestUnstake/claimUnstake (the new stake widget)
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
  // System auto-assigns the current top-ranked validator to this block —
  // no manual validator signature needed, mirrors real blockchain behavior.
  const validatorId = (await resolveBlockProducer(blockIndex)) ?? await getActiveValidator();

  await ledgerClient.query(`
    INSERT INTO ledger.blocks (block_index, block_hash, prev_hash, sequence_hash, merkle_root, tx_count, total_gas, is_empty, validator_id)
    VALUES ($1,$2,$3,$4,$5,1,0,FALSE,$6)
  `, [blockIndex, blockHash, prevHash, sequenceHash, merkleRoot, validatorId]);

  publishBlockToRailway({
    height: blockIndex, hash: blockHash, previousHash: prevHash, merkleRoot,
    validator: validatorId, timestamp, epoch: Math.floor(timestamp / 86_400_000),
    signature: signChainHeader(blockIndex, blockHash), // BUG FIX: this direct-seal path never signed before — every stake/unstake block was rejected by Light Nodes as "missing signature"
  });

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
        eastpass_tier = $2, stake_locked_until = $3, last_active = $4,
        last_staking_claim_at = CASE WHEN last_staking_claim_at = 0 THEN $4 ELSE last_staking_claim_at END,
        updated_at = NOW()
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

  // ── Flexible-amount staking widget flow ──────────────────────────
  // Unlike the tier-card 'unstake' above (instant, but blocked until the
  // 30-day stake_locked_until passes), this is: request unstake for any
  // amount up to what's staked — takes effect immediately (stops counting
  // toward tier/boost right away) — then the funds sit in escrow for
  // UNSTAKE_CLAIM_DELAY_MS before claimUnstake() can move them to balance.
  if (functionName === 'requestUnstake') {
    const staked = Number(user.staked_amount);
    const requested = params.amount !== undefined ? Number(params.amount) : staked;
    if (!Number.isFinite(requested) || requested <= 0) return { success: false, error: 'INVALID_AMOUNT' };
    if (requested > staked) return { success: false, error: 'INSUFFICIENT_STAKE' };

    const timestamp = Date.now();
    const claimableAt = timestamp + UNSTAKE_CLAIM_DELAY_MS;
    const newStaked = staked - requested;
    const newTier = getTierFromStaked(newStaked);
    // Accumulates if a previous request hasn't been claimed yet, and resets
    // the timer to a fresh 24h from now for the combined pending amount —
    // keeps the model simple (one pending bucket per user) rather than a
    // queue of independently-timed partial unstakes.
    const newPending = Number(user.pending_unstake_amount || 0) + requested;
    const hash = txHash(`requestunstake_${tgId}`);

    const { blockIndex, blockHash } = await sealSingleTx(ledgerClient, {
      // Funds haven't reached the user's wallet yet — still escrowed in the
      // pool — so sender and recipient are both the pool; the chain record
      // exists so the request itself is auditable.
      txHash: hash, txType: 'UNSTAKE_REQUEST', senderAddress: STAKING_POOL_ADDRESS,
      recipientAddress: STAKING_POOL_ADDRESS, senderId: 'staking_pool', recipientId: tgId, amount: requested,
    });

    await identityClient.query(`
      UPDATE identity.users SET staked_amount = $1, eastpass_tier = $2,
        pending_unstake_amount = $3, pending_unstake_claimable_at = $4, updated_at = NOW()
      WHERE telegram_id = $5
    `, [newStaked, newTier.level, newPending, claimableAt, tgId]);

    return { success: true, data: { txHash: hash, blockIndex, blockHash, requested, claimableAt } };
  }

  if (functionName === 'claimUnstake') {
    const pending = Number(user.pending_unstake_amount || 0);
    if (pending <= 0) return { success: false, error: 'NOTHING_TO_CLAIM' };
    const claimableAt = Number(user.pending_unstake_claimable_at || 0);
    if (Date.now() < claimableAt) {
      const remainingSeconds = Math.ceil((claimableAt - Date.now()) / 1000);
      return { success: false, error: `CLAIM_DELAY_ACTIVE:${remainingSeconds}` };
    }

    const hash = txHash(`claimunstake_${tgId}`);
    const { blockIndex, blockHash } = await sealSingleTx(ledgerClient, {
      txHash: hash, txType: 'UNSTAKE_CLAIM', senderAddress: STAKING_POOL_ADDRESS,
      recipientAddress: user.wallet_address, senderId: 'staking_pool', recipientId: tgId, amount: pending,
    });

    await identityClient.query(`
      UPDATE identity.users SET balance = balance + $1, pending_unstake_amount = 0,
        pending_unstake_claimable_at = 0, updated_at = NOW()
      WHERE telegram_id = $2
    `, [pending, tgId]);

    return { success: true, data: { txHash: hash, blockIndex, blockHash, claimed: pending } };
  }

  if (functionName === 'claimStakingReward') {
    const staked = Number(user.staked_amount);
    if (staked <= 0) return { success: false, error: 'NOTHING_STAKED' };

    // Dedicated timestamp — NOT last_active, which mining claims and
    // stake() itself also touch and would silently reset this clock.
    const lastClaim = Number(user.last_staking_claim_at || 0) || Number(user.created_at ? new Date(user.created_at).getTime() : Date.now());
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
      UPDATE identity.users SET balance = balance + $1, last_active = $2, last_staking_claim_at = $2, updated_at = NOW()
      WHERE telegram_id = $3
    `, [reward, Date.now(), tgId]);

    return { success: true, data: { txHash: hash, blockIndex, blockHash, reward } };
  }

  return { success: false, error: 'UNIMPLEMENTED_FUNCTION' };
}
