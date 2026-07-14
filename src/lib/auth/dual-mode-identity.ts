/**
 * EASTCHAIN — Dual-mode identity verification
 * ─────────────────────────────────────────────────────────────────────
 * Utility to support TWO ways a user can prove "I am the person who
 * should execute this transaction":
 *
 *   1. Telegram initData — proof they opened the Mini App and are in
 *      an active Telegram session. (original method, still valid)
 *   2. Self-custody signature — they sign a payload with their
 *      self-custody key, proving they hold the private key. (new method,
 *      allows transactions outside Telegram)
 *
 * A transaction needs exactly ONE of these, not both. Both is fine too,
 * but only one is required to pass. This makes it backwards-compatible:
 * old requests that only have initData still work; new requests that
 * only have signature also work.
 *
 * DUAL SIGNATURE SCHEME SUPPORT (secp256k1 migration, in progress):
 * Path 2 now accepts EITHER key type — whichever the account actually
 * has registered:
 *   - Ed25519 (legacy self-custody, migration 002, `self_custody_pubkey`)
 *   - secp256k1 / EIP-191 (self-custody EVM wallet, migration 003,
 *     `wallet_address` when `wallet_type = 'self_custody_evm'`)
 * Both are tried if both are available; either one succeeding is enough.
 * This is intentionally NOT a hard cutover — existing Ed25519 self-custody
 * users keep working exactly as before, EVM self-custody users (the
 * default for new signups) newly gain the ability to authorize via their
 * own key instead of only via Telegram initData. Once every account has
 * migrated to `self_custody_evm`, the Ed25519 branch can be deleted.
 */

import { verifyMessage } from 'ethers';
import { validateTelegramData, extractVerifiedUserId } from '@/lib/telegram';
import { verifySignature } from '@/lib/keypair-service';

export type VerifyIdentityResult =
  | { success: true; telegramId: string; method: 'telegram' | 'signature' }
  | { success: false; error: string };

/** secp256k1 / EIP-191 check — same recovery pattern as evm-signature.ts's verifyEvmOwnership. */
function verifySecp256k1(evmAddress: string, payload: string, signature: string): boolean {
  try {
    const recovered = verifyMessage(payload, signature);
    return recovered.toLowerCase() === evmAddress.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Verify that a user is who they claim to be, via Telegram OR signature.
 * Returns the verified telegram_id if successful.
 *
 * @param claimedTelegramId — the telegramId the caller says they are
 * @param initData — optional Telegram initData from Mini App
 * @param selfCustodyPubkey — optional Ed25519 public key registered in identity.users.self_custody_pubkey (legacy)
 * @param signature — optional signature over payload (Ed25519 hex OR secp256k1 EIP-191 hex, either accepted)
 * @param signaturePayload — the exact string that was signed (required if signature is provided)
 * @param isProduction — whether to enforce strict checks (skip in dev)
 * @param evmAddress — optional secp256k1 self-custody address (identity.users.wallet_address
 *                      when wallet_type = 'self_custody_evm') — new signature scheme
 *
 * Returns: { success: true, telegramId, method } if EITHER initData OR signature is valid.
 *          { success: false, error } otherwise.
 */
export async function verifyIdentityOrSignature(
  claimedTelegramId: string,
  initData: string | undefined,
  selfCustodyPubkey: string | undefined,
  signature: string | undefined,
  signaturePayload: string | undefined,
  isProduction: boolean,
  evmAddress?: string
): Promise<VerifyIdentityResult> {
  // Dev mode — skip all checks
  if (!isProduction) {
    return { success: true, telegramId: claimedTelegramId, method: 'telegram' };
  }

  const errors: string[] = [];

  // ── Path 1: Telegram initData ───────────────────────────────────
  if (initData) {
    try {
      if (!validateTelegramData(initData)) {
        errors.push('INVALID_INITDATA_SIGNATURE');
      } else {
        const verifiedId = extractVerifiedUserId(initData);
        if (!verifiedId) {
          errors.push('INITDATA_MISSING_USER');
        } else if (verifiedId !== claimedTelegramId) {
          errors.push('INITDATA_ID_MISMATCH');
        } else {
          // ✅ initData is valid and matches claimed ID
          return { success: true, telegramId: claimedTelegramId, method: 'telegram' };
        }
      }
    } catch (err) {
      errors.push(`INITDATA_PARSE_ERROR: ${(err as any).message}`);
    }
  }

  // ── Path 2: Self-custody signature — secp256k1 OR Ed25519 ────────
  if (signature && signaturePayload) {
    // Try secp256k1 (EVM self-custody, migration 003) first — this is
    // where new accounts live going forward.
    if (evmAddress) {
      if (verifySecp256k1(evmAddress, signaturePayload, signature)) {
        return { success: true, telegramId: claimedTelegramId, method: 'signature' };
      }
      errors.push('INVALID_SIGNATURE_SECP256K1');
    }

    // Fall back to Ed25519 (legacy self-custody, migration 002) —
    // harmless to attempt even if the account is EVM-only: a secp256k1
    // signature simply isn't valid nacl input and verifySignature()
    // returns false/throws, caught below.
    if (selfCustodyPubkey) {
      try {
        const valid = await verifySignature(selfCustodyPubkey, signaturePayload, signature);
        if (valid) {
          return { success: true, telegramId: claimedTelegramId, method: 'signature' };
        }
        errors.push('INVALID_SIGNATURE_ED25519');
      } catch (err) {
        errors.push(`SIGNATURE_VERIFY_ERROR: ${(err as any).message}`);
      }
    }

    if (!evmAddress && !selfCustodyPubkey) {
      errors.push('NO_KEY_REGISTERED');
    }
  }

  // ── Both failed (or both absent) ────────────────────────────────
  if (!initData && !signature) {
    return { success: false, error: 'NO_AUTH_METHOD' };
  }

  // One or both were provided but neither worked
  return {
    success: false,
    error: errors.length > 0 ? errors[0] : 'IDENTITY_VERIFICATION_FAILED',
  };
}

/**
 * Quick validation: does caller have SOME self-custody key registered
 * (either scheme)? Used to decide if signature-based auth is even an option.
 */
export function hasSelfCustody(selfCustodyPubkey: string | null, evmAddress?: string | null): boolean {
  return !!selfCustodyPubkey || !!evmAddress;
}
