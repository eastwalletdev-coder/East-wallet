'use server';

/**
 * EASTCHAIN — Wallet Onboarding Actions
 * ─────────────────────────────────────────────────────────────────────
 * Handles the "create your wallet before you can mine" flow for new
 * users, and the optional "upgrade to self-custody" flow for legacy
 * users who still have a cosmetic hash-based wallet_address.
 *
 * Neither path ever sees a private key or mnemonic — only an address,
 * a public key, and a signature proving the caller controls that
 * address (see wallet-service.ts + wallet-context.tsx on the client —
 * the same 'east_vault' that backs the multi-chain Wallet tab —
 * and evm-signature.ts here).
 */

import { identityPool } from '@/lib/db/identity';
import { getCachedUser, setCachedUser, invalidateCachedUser } from '@/lib/db/redis';
import { validateTelegramData, extractVerifiedUserId } from '@/lib/telegram';
import { verifyEvmOwnership, isValidEvmAddress } from '@/lib/evm-signature';
import { generateEastId } from '@/lib/east-id';

const FOUNDER_IDS = (process.env.FOUNDER_IDS || '').split(',').map(id => id.trim()).filter(Boolean);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

function buildOwnershipPayload(telegramId: string, address: string): string {
  return `EASTCHAIN_WALLET_INIT_${telegramId}_${address.toLowerCase()}`;
}

function assertIdentity(telegramId: string, initData?: string): { ok: true } | { ok: false; error: string } {
  if (!IS_PRODUCTION) return { ok: true };
  if (!initData || !validateTelegramData(initData)) return { ok: false, error: 'IDENTITY_VIOLATION' };
  const verifiedId = extractVerifiedUserId(initData);
  if (!verifiedId || verifiedId !== telegramId) return { ok: false, error: 'IDENTITY_MISMATCH' };
  return { ok: true };
}

function mapUserRow(row: any, eastId: string) {
  return {
    telegramId: row.telegram_id,
    walletAddress: row.wallet_address,
    walletType: row.wallet_type,
    eastId,
    username: row.username,
    balance: Number(row.balance),
    stakedAmount: Number(row.staked_amount),
    pendingUnstakeAmount: Number(row.pending_unstake_amount || 0),
    pendingUnstakeClaimableAt: Number(row.pending_unstake_claimable_at || 0),
    eastpassTier: Number(row.eastpass_tier),
    isFounder: row.is_founder,
    referredBy: row.referred_by,
    totalReferralBonus: Number(row.total_referral_bonus),
  };
}

/**
 * Lightweight check used right when a user lands on the app / taps
 * "Initiate Mining Cycle": does this telegram_id already have a row?
 * Never creates anything — pure read.
 */
export async function checkWalletStatus(telegramId: string): Promise<{
  exists: boolean;
  walletType?: string;
}> {
  const cached = await getCachedUser(telegramId);
  if (cached) return { exists: true, walletType: (cached as any).walletType || 'custodial_hash' };

  const client = await identityPool.connect();
  try {
    const res = await client.query(
      'SELECT wallet_type FROM identity.users WHERE telegram_id = $1', [telegramId]
    );
    if (!res.rows.length) return { exists: false };
    return { exists: true, walletType: res.rows[0].wallet_type || 'custodial_hash' };
  } finally {
    client.release();
  }
}

/**
 * Creates the very first row for a brand-new telegram_id, using a
 * client-generated, client-proven EVM self-custody address instead of
 * the legacy server-fabricated hash. Fails if a row already exists —
 * use upgradeToSelfCustodyWallet for that case instead.
 */
export async function createSelfCustodyWallet(
  telegramId: string,
  username: string,
  address: string,
  publicKey: string,
  signature: string,
  initData?: string,
  startParam?: string,
) {
  const identity = assertIdentity(telegramId, initData);
  if (!identity.ok) return { success: false, error: identity.error };

  if (!isValidEvmAddress(address)) return { success: false, error: 'INVALID_ADDRESS' };

  const payload = buildOwnershipPayload(telegramId, address);
  if (!verifyEvmOwnership(address, payload, signature)) {
    return { success: false, error: 'INVALID_SIGNATURE' };
  }

  const isFounder = FOUNDER_IDS.includes(telegramId);
  const eastId = generateEastId(address);

  const client = await identityPool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      'SELECT telegram_id FROM identity.users WHERE telegram_id = $1 FOR UPDATE', [telegramId]
    );
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return { success: false, error: 'USER_ALREADY_EXISTS' };
    }

    await client.query(`
      INSERT INTO identity.users
        (telegram_id, wallet_address, username, is_founder, wallet_type, evm_public_key, evm_wallet_migrated_at)
      VALUES ($1, $2, $3, $4, 'self_custody_evm', $5, NOW())
    `, [telegramId, address, username, isFounder, publicKey]);

    // Auto-register referral from Telegram deep link start_param — same
    // behavior as the legacy registerOrUpdateUser flow.
    if (startParam && startParam !== telegramId) {
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

    const userRes = await client.query('SELECT * FROM identity.users WHERE telegram_id = $1', [telegramId]);
    await client.query('COMMIT');

    const userData = mapUserRow(userRes.rows[0], eastId);
    await setCachedUser(telegramId, userData);

    return {
      success: true,
      user: userData,
      referralLink: `https://t.me/${process.env.NEXT_PUBLIC_BOT_USERNAME || 'Eastwallet_bot'}?start=${telegramId}`,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[EASTCHAIN] createSelfCustodyWallet error:', err);
    return { success: false, error: 'SERVER_ERROR' };
  } finally {
    client.release();
  }
}

/**
 * Voluntary upgrade path for legacy users who already have a
 * 'custodial_hash' wallet_address. Swaps it for a real self-custody EVM
 * address. Non-blocking, opt-in — never called automatically.
 *
 * NOTE: this changes the user's on-chain address. Any balance already
 * attributed to the old hash address stays attributed to telegram_id in
 * this ledger design (balance lives on identity.users, not on the
 * address itself), so the swap is safe here — but if EAST balances are
 * ever moved to an address-keyed model, this needs an explicit balance
 * migration step too.
 */
export async function upgradeToSelfCustodyWallet(
  telegramId: string,
  address: string,
  publicKey: string,
  signature: string,
  initData?: string,
) {
  const identity = assertIdentity(telegramId, initData);
  if (!identity.ok) return { success: false, error: identity.error };

  if (!isValidEvmAddress(address)) return { success: false, error: 'INVALID_ADDRESS' };

  const payload = buildOwnershipPayload(telegramId, address);
  if (!verifyEvmOwnership(address, payload, signature)) {
    return { success: false, error: 'INVALID_SIGNATURE' };
  }

  const client = await identityPool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      'SELECT * FROM identity.users WHERE telegram_id = $1 FOR UPDATE', [telegramId]
    );
    if (!existing.rows.length) {
      await client.query('ROLLBACK');
      return { success: false, error: 'USER_NOT_FOUND' };
    }
    const prev = existing.rows[0];
    const prevAddr = String(prev.wallet_address || '').toLowerCase();
    const nextAddr = address.toLowerCase();

    // Same address already registered → idempotent success (import/re-open).
    // Different address with valid signature → rebind Profile to vault (import mnemonic).
    if (prev.wallet_type === 'self_custody_evm' && prevAddr === nextAddr) {
      await client.query('ROLLBACK');
      const eastId = generateEastId(address);
      return { success: true, user: mapUserRow(prev, eastId), alreadySynced: true };
    }

    await client.query(`
      UPDATE identity.users
      SET wallet_address = $1, wallet_type = 'self_custody_evm',
          evm_public_key = $2, evm_wallet_migrated_at = NOW(), updated_at = NOW()
      WHERE telegram_id = $3
    `, [address, publicKey, telegramId]);

    const userRes = await client.query('SELECT * FROM identity.users WHERE telegram_id = $1', [telegramId]);
    await client.query('COMMIT');

    const eastId = generateEastId(address);
    const userData = mapUserRow(userRes.rows[0], eastId);
    await invalidateCachedUser(telegramId);
    await setCachedUser(telegramId, userData);

    return { success: true, user: userData };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[EASTCHAIN] upgradeToSelfCustodyWallet error:', err);
    return { success: false, error: 'SERVER_ERROR' };
  } finally {
    client.release();
  }
}
