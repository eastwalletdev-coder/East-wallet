/**
 * EASTCHAIN — Vesting Contract (address: CONTRACTS.VESTING)
 * Founder allocation, released monthly from ledger.supply_buckets('founder').
 * Only telegram_ids listed in FOUNDER_IDS may call claimVested — this is
 * checked here AND re-checked by the engine caller, matching the same
 * founder-gating pattern already used for getAuditTrail().
 */
import { mintFromBucket } from '@/lib/db/ledger';
import { computeBlockHash, computeSequenceHash, computeMerkleRoot, getActiveValidator } from '@/lib/block-engine';
import { signChainHeader } from '@/lib/consensus/chain-signing';
import { resolveBlockProducer } from '@/lib/consensus/leader-schedule';
import { publishBlockToRailway } from '@/lib/lightnode-publisher';
import crypto from 'crypto';

const SYSTEM_ADDRESS = '0x0000000000000000000000000000000000000000';
const FOUNDER_IDS = (process.env.FOUNDER_IDS || '').split(',').map((id) => id.trim()).filter(Boolean);

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
    signature: signChainHeader(blockIndex, blockHash), // BUG FIX: this direct-seal path never signed before — every claimVested block was rejected by Light Nodes as "missing signature"
  });

  await ledgerClient.query(`
    INSERT INTO ledger.transactions (tx_hash, block_index, tx_type, sender_address, recipient_address, sender_id, recipient_id, amount, gas_fee, status)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,'confirmed')
  `, [tx.txHash, blockIndex, tx.txType, tx.senderAddress, tx.recipientAddress, tx.senderId, tx.recipientId, tx.amount]);

  return { blockIndex, blockHash };
}

export async function execute(
  functionName: string,
  _params: Record<string, any>,
  ctx: { tgId: string; user: any; identityClient: any; ledgerClient: any }
): Promise<{ success: boolean; error?: string; data?: any }> {
  const { tgId, user, identityClient, ledgerClient } = ctx;
  if (functionName !== 'claimVested') return { success: false, error: 'UNIMPLEMENTED_FUNCTION' };

  if (!FOUNDER_IDS.includes(tgId)) return { success: false, error: 'NOT_AUTHORIZED' };

  // Look for a row already bound to this founder. If none exists yet, fall
  // back to an unbound legacy row (founder_telegram_id IS NULL) and bind it
  // to this caller permanently — first authorized claimant owns that pool
  // from then on. This closes the gap where any current FOUNDER_IDS entry
  // could previously claim whichever row was most recently created.
  let vestingRes = await identityClient.query(`
    SELECT * FROM identity.vesting WHERE founder_telegram_id = $1 LIMIT 1 FOR UPDATE
  `, [tgId]);

  if (!vestingRes.rows.length) {
    const unbound = await identityClient.query(`
      SELECT * FROM identity.vesting WHERE founder_telegram_id IS NULL
      ORDER BY created_at ASC LIMIT 1 FOR UPDATE
    `);
    if (!unbound.rows.length) return { success: false, error: 'NO_VESTING_SCHEDULE' };
    await identityClient.query(
      'UPDATE identity.vesting SET founder_telegram_id = $1 WHERE id = $2',
      [tgId, unbound.rows[0].id]
    );
    vestingRes = unbound;
  }
  const vesting = vestingRes.rows[0];

  if (vesting.is_completed) return { success: false, error: 'VESTING_COMPLETED' };
  if (vesting.next_unlock && new Date(vesting.next_unlock).getTime() > Date.now()) {
    return { success: false, error: 'NOT_YET_UNLOCKED' };
  }

  const releaseAmount = Math.min(
    Number(vesting.monthly_release),
    Number(vesting.total_amount) - Number(vesting.unlocked_amount)
  );
  if (releaseAmount <= 0) return { success: false, error: 'NOTHING_TO_CLAIM' };

  const mint = await mintFromBucket(ledgerClient, 'founder', releaseAmount, 'vesting_claim', tgId);
  if (!mint.ok) return { success: false, error: `FOUNDER_BUCKET_EXHAUSTED: ${mint.reason}` };

  const hash = txHash(`vesting_${tgId}`);
  const { blockIndex, blockHash } = await sealSingleTx(ledgerClient, {
    txHash: hash, txType: 'VESTING_CLAIM', senderAddress: SYSTEM_ADDRESS,
    recipientAddress: user.wallet_address, senderId: 'system', recipientId: tgId, amount: releaseAmount,
  });

  const newUnlocked = Number(vesting.unlocked_amount) + releaseAmount;
  const newMonthsReleased = Number(vesting.months_released) + 1;
  const isCompleted = newUnlocked >= Number(vesting.total_amount) || newMonthsReleased >= Number(vesting.total_months);
  const nextUnlock = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await identityClient.query(`
    UPDATE identity.vesting SET
      unlocked_amount = $1, months_released = $2, is_completed = $3,
      next_unlock = $4
    WHERE id = $5
  `, [newUnlocked, newMonthsReleased, isCompleted, isCompleted ? null : nextUnlock, vesting.id]);

  await identityClient.query(
    'UPDATE identity.users SET balance = balance + $1, updated_at = NOW() WHERE telegram_id = $2',
    [releaseAmount, tgId]
  );

  return { success: true, data: { txHash: hash, blockIndex, blockHash, released: releaseAmount, unlockedTotal: newUnlocked, isCompleted } };
}
