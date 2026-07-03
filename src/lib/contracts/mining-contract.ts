/**
 * EASTCHAIN — Mining Contract (address: CONTRACTS.MINING)
 * Runs inside the engine's already-open transaction. The 24h claim
 * cooldown itself is still enforced by the caller (contract-actions.ts)
 * BEFORE the engine call, via Redis — same as before this refactor.
 */
import { mintFromBucket } from '@/lib/db/ledger';
import { getTierFromStaked } from '@/lib/ledger';
import { computeBlockHash, computeSequenceHash, computeMerkleRoot, getActiveValidator } from '@/lib/block-engine';
import { MINING_REWARD, REFERRAL_BONUS, REFERRAL_CAP, REFERRAL_CLAIM_TRIGGER } from '@/lib/blockchain';
import { publishBlockToRailway } from '@/lib/lightnode-publisher';
import crypto from 'crypto';

const SYSTEM_ADDRESS = '0x0000000000000000000000000000000000000000';
const MINING_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24h — mirrors Redis TTL, but this is the real gate

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
  // no manual validator signature needed, mirrors real blockchain behavior
  // where the elected validator/proposer is attributed to each block.
  const validatorId = await getActiveValidator();

  await ledgerClient.query(`
    INSERT INTO ledger.blocks (block_index, block_hash, prev_hash, sequence_hash, merkle_root, tx_count, total_gas, is_empty, validator_id)
    VALUES ($1,$2,$3,$4,$5,1,0,FALSE,$6)
  `, [blockIndex, blockHash, prevHash, sequenceHash, merkleRoot, validatorId]);

  // Relay to Light Nodes via Railway — fire-and-forget, never blocks the claim
  publishBlockToRailway({
    height: blockIndex, hash: blockHash, previousHash: prevHash, merkleRoot,
    validator: validatorId, timestamp, epoch: Math.floor(timestamp / 86_400_000),
  });

  await ledgerClient.query(`
    INSERT INTO ledger.transactions (tx_hash, block_index, tx_type, sender_address, recipient_address, sender_id, recipient_id, amount, gas_fee, status)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,'confirmed')
  `, [tx.txHash, blockIndex, tx.txType, tx.senderAddress, tx.recipientAddress, tx.senderId, tx.recipientId, tx.amount]);

  return { blockIndex, blockHash, sequenceHash };
}

export async function execute(
  functionName: string,
  params: Record<string, any>,
  ctx: { tgId: string; user: any; identityClient: any; ledgerClient: any }
): Promise<{ success: boolean; error?: string; data?: any }> {
  const { tgId, user, identityClient, ledgerClient } = ctx;
  if (functionName !== 'claimMiningReward') return { success: false, error: 'UNIMPLEMENTED_FUNCTION' };

  // Authoritative cooldown gate — `user` was fetched with FOR UPDATE by the
  // engine, so this check + the mint below are atomic with respect to any
  // other concurrent call for the same tgId. Redis (contract-actions.ts)
  // is only a fast pre-check for UX now; this is what actually enforces it.
  const lastClaimAt = Number(user.last_mining_claim_at || 0);
  const elapsed = Date.now() - lastClaimAt;
  if (lastClaimAt > 0 && elapsed < MINING_COOLDOWN_MS) {
    return {
      success: false,
      error: `COOLDOWN_ACTIVE:${Math.ceil((MINING_COOLDOWN_MS - elapsed) / 1000)}`,
    };
  }

  const tier = getTierFromStaked(Number(user.staked_amount));
  const boostedReward = MINING_REWARD * tier.boost;

  const mint = await mintFromBucket(ledgerClient, 'mining', boostedReward, 'mining_reward', tgId);
  if (!mint.ok) return { success: false, error: `MINING_POOL_EXHAUSTED: ${mint.reason}` };

  const hash = txHash(`mine_${tgId}`);
  const { blockIndex, blockHash, sequenceHash } = await sealSingleTx(ledgerClient, {
    txHash: hash, txType: 'MINING', senderAddress: SYSTEM_ADDRESS,
    recipientAddress: user.wallet_address, senderId: 'system', recipientId: tgId, amount: boostedReward,
  });

  await identityClient.query(
    'UPDATE identity.users SET balance = balance + $1, last_active = $2, last_mining_claim_at = $2, updated_at = NOW() WHERE telegram_id = $3',
    [boostedReward, Date.now(), tgId]
  );

  // Referral bonus on 4th claim — mirrors previous claimMiningReward behaviour.
  const claimCountKey = `claim_count:${tgId}`;
  const ccRes = await ledgerClient.query('SELECT value FROM ledger.chain_meta WHERE key = $1', [claimCountKey]);
  const claimCount = ccRes.rows.length > 0 ? parseInt(ccRes.rows[0].value) + 1 : 1;
  await ledgerClient.query(`
    INSERT INTO ledger.chain_meta (key, value) VALUES ($1, $2)
    ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
  `, [claimCountKey, String(claimCount)]);

  let referralPaid = false;
  if (claimCount === REFERRAL_CLAIM_TRIGGER && user.referred_by) {
    const referrerRes = await identityClient.query(
      'SELECT * FROM identity.users WHERE telegram_id = $1 FOR UPDATE', [user.referred_by]
    );
    if (referrerRes.rows.length > 0) {
      const referrer = referrerRes.rows[0];
      if (Number(referrer.total_referral_bonus) < REFERRAL_CAP) {
        const refMint = await mintFromBucket(ledgerClient, 'campaign', REFERRAL_BONUS, 'referral_bonus', referrer.telegram_id);
        if (refMint.ok) {
          await identityClient.query(
            'UPDATE identity.users SET balance = balance + $1, total_referral_bonus = total_referral_bonus + $1, updated_at = NOW() WHERE telegram_id = $2',
            [REFERRAL_BONUS, referrer.telegram_id]
          );
          const refHash = txHash(`referral_${referrer.telegram_id}`);
          await sealSingleTx(ledgerClient, {
            txHash: refHash, txType: 'REFERRAL_BONUS', senderAddress: SYSTEM_ADDRESS,
            recipientAddress: referrer.wallet_address, senderId: 'system', recipientId: referrer.telegram_id,
            amount: REFERRAL_BONUS,
          });
          await identityClient.query(
            'UPDATE identity.referrals SET bonus_paid = TRUE WHERE referrer_id = $1 AND referred_id = $2',
            [referrer.telegram_id, tgId]
          );
          referralPaid = true;
        }
      }
    }
  }

  return { success: true, data: { txHash: hash, blockIndex, blockHash, sequenceHash, reward: boostedReward, referralPaid } };
}
