'use server';

/**
 * EASTCHAIN — Contract Actions
 * Thin, typed wrappers around lib/contracts/engine.ts for each "contract".
 * mining-actions.ts's existing stakeEast/claimMiningReward now delegate
 * here internally (see that file) — kept in a separate module so the
 * contract-engine surface area is easy to audit on its own.
 */
import { callContract } from '@/lib/contracts/engine';
import { CONTRACTS } from '@/lib/contracts/registry';
import { checkClaimCooldown, setClaimCooldown, invalidateCachedUser } from '@/lib/db/redis';

// ─── Staking ─────────────────────────────────────────────────────
export async function stakeEastContract(
  tgId: string,
  amount: number,
  initData?: string,
  signature?: string,
  selfCustodyPubkey?: string
) {
  if (!Number.isFinite(amount) || amount <= 0) return { success: false, error: 'INVALID_AMOUNT' };
  const res = await callContract({
    tgId, initData, contractAddress: CONTRACTS.STAKING, functionName: 'stake', params: { amount },
    signature, selfCustodyPubkey,
  });
  if (res.success) await invalidateCachedUser(tgId);
  return res;
}

export async function unstakeEastContract(tgId: string, initData?: string) {
  const res = await callContract({
    tgId, initData, contractAddress: CONTRACTS.STAKING, functionName: 'unstake', params: {},
  });
  if (res.success) await invalidateCachedUser(tgId);
  return res;
}

export async function claimStakingRewardContract(tgId: string, initData?: string) {
  const res = await callContract({
    tgId, initData, contractAddress: CONTRACTS.STAKING, functionName: 'claimStakingReward', params: {},
  });
  if (res.success) await invalidateCachedUser(tgId);
  return res;
}

// ─── Vesting (founder allocation) ─────────────────────────────────
export async function claimVestedContract(tgId: string, initData?: string) {
  const res = await callContract({
    tgId, initData, contractAddress: CONTRACTS.VESTING, functionName: 'claimVested', params: {},
  });
  if (res.success) await invalidateCachedUser(tgId);
  return res;
}

// ─── Mining ────────────────────────────────────────────────────────
export async function claimMiningRewardContract(
  tgId: string,
  initData?: string,
  verifiedHeaders?: number,
  signature?: string,
  selfCustodyPubkey?: string
) {
  // Fast pre-check (Redis) — pure UX, saves a wasted round trip for an
  // obviously-too-early claim. NOT the source of truth: see mining-contract.ts,
  // the DB-side check inside the row-locked transaction is what's authoritative.
  const cooldown = await checkClaimCooldown(tgId);
  if (!cooldown.allowed) return { success: false, error: 'COOLDOWN_ACTIVE', remainingSeconds: cooldown.remainingSeconds };

  const res = await callContract({
    tgId, initData, contractAddress: CONTRACTS.MINING, functionName: 'claimMiningReward',
    params: { verifiedHeaders: verifiedHeaders || 0 },
    signature, selfCustodyPubkey,
  });

  if (!res.success && res.error?.startsWith('COOLDOWN_ACTIVE:')) {
    const remainingSeconds = Number(res.error.split(':')[1]) || 0;
    return { success: false, error: 'COOLDOWN_ACTIVE', remainingSeconds };
  }

  if (res.success) {
    await setClaimCooldown(tgId);
    await invalidateCachedUser(tgId);
  }
  return res;
}

// ─── Validator governance vote ─────────────────────────────────────
export async function voteValidatorContract(
  tgId: string, roundId: string, vote: 'approve' | 'reject', initData?: string
) {
  return callContract({
    tgId, initData, contractAddress: CONTRACTS.VALIDATOR, functionName: 'vote', params: { roundId, vote },
  });
}
