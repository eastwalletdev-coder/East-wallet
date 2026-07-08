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
 */

import { validateTelegramData, extractVerifiedUserId } from '@/lib/telegram';
import { verifySignature } from '@/lib/keypair-service';

export type VerifyIdentityResult =
  | { success: true; telegramId: string; method: 'telegram' | 'signature' }
  | { success: false; error: string };

/**
 * Verify that a user is who they claim to be, via Telegram OR signature.
 * Returns the verified telegram_id if successful.
 *
 * @param claimedTelegramId — the telegramId the caller says they are
 * @param initData — optional Telegram initData from Mini App
 * @param selfCustodyPubkey — optional public key registered in identity.users.self_custody_pubkey
 * @param signature — optional ed25519 signature over payload
 * @param signaturePayload — the exact string that was signed (required if signature is provided)
 * @param isProduction — whether to enforce strict checks (skip in dev)
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
  isProduction: boolean
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

  // ── Path 2: Self-custody signature ───────────────────────────────
  if (signature && selfCustodyPubkey && signaturePayload) {
    try {
      const valid = await verifySignature(selfCustodyPubkey, signaturePayload, signature);
      if (valid) {
        // ✅ Signature is valid
        return { success: true, telegramId: claimedTelegramId, method: 'signature' };
      } else {
        errors.push('INVALID_SIGNATURE');
      }
    } catch (err) {
      errors.push(`SIGNATURE_VERIFY_ERROR: ${(err as any).message}`);
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
 * Quick validation: does caller have self-custody pubkey registered?
 * Used to decide if signature-based auth is even an option.
 */
export function hasSelfCustody(selfCustodyPubkey: string | null): boolean {
  return !!selfCustodyPubkey;
}
