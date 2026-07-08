'use server';

/**
 * EASTCHAIN — Self-custody & validator candidacy actions
 * ─────────────────────────────────────────────────────────────────────
 * These actions are the "front door" for the migration plan discussed
 * with the team:
 *   1. registerSelfCustody   — user proves they hold a keypair themselves
 *      (generated client-side, never sent to the server) by signing a
 *      claim message with their EXISTING server-derivable EAST key
 *      (exported once via wallet-export-actions.ts). This does NOT
 *      change how sendEast/stakeEast are authorized yet — that stays on
 *      initData for now, by deliberate choice (see project discussion).
 *      It only records that the user has taken custody of their key.
 *   2. applyAsValidatorCandidate — self-custodial users can apply to
 *      become a validator. Lands in identity.validator_candidates as
 *      'pending_review'. Nothing here auto-approves; approval is a
 *      separate admin action (reviewValidatorApplication).
 *
 * Both require self-custody FIRST — a candidacy signed with a key the
 * server itself derived would prove nothing.
 */

import { validateTelegramData, extractVerifiedUserId } from '@/lib/telegram';
import {
  buildSelfCustodyClaimMessage,
  buildValidatorClaimMessage,
  setSelfCustodyPubkey,
  getSelfCustodyStatus,
  submitValidatorCandidate,
  listValidatorCandidates,
  reviewValidatorCandidate,
} from '@/lib/db/identity';
import { verifySignature } from '@/lib/keypair-service';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

function requireVerifiedTelegramId(
  telegramId: string,
  initData: string,
  adminSecret?: string
): { ok: true } | { ok: false; error: string } {
  // Admin/CLI bypass — used by scripts/apply-validator-cli.js, which runs
  // outside Telegram entirely and therefore cannot produce a real,
  // HMAC-signed initData string. Trusted because whoever holds
  // ADMIN_SECRET already controls the server; appropriate for the current
  // handful-of-admins phase, not something to keep once candidacy is
  // opened to arbitrary outside users (see prior discussion).
  if (adminSecret && adminSecret === process.env.ADMIN_SECRET) return { ok: true };
  if (!IS_PRODUCTION) return { ok: true }; // relaxed in dev, same convention as other actions
  if (!initData || !validateTelegramData(initData)) return { ok: false, error: 'IDENTITY_VIOLATION' };
  const verifiedId = extractVerifiedUserId(initData);
  if (!verifiedId || verifiedId !== telegramId) return { ok: false, error: 'IDENTITY_MISMATCH' };
  return { ok: true };
}

/**
 * Step 1 of the self-custody flow. Client has already:
 *   - called exportWalletSecrets() to get the mnemonic once,
 *   - imported it into (or generated a fresh keypair inside) a local,
 *     device-only encrypted wallet,
 *   - built the exact claim message via buildSelfCustodyClaimMessage()
 *     and signed it with that key.
 *
 * We verify the signature against the pubkey the client says is theirs,
 * then record it. We deliberately do NOT re-derive the key server-side
 * to check the pubkey matches the custodial one — a user is free to
 * register a brand-new keypair they generated fresh, not just re-import
 * the old exported one. Proof of "you can sign with this key" is what
 * matters, not "this key equals the old custodial one".
 */
export async function registerSelfCustody(
  telegramId: string,
  pubkeyHex: string,
  signatureHex: string,
  initData: string,
  adminSecret?: string
): Promise<{ success: true } | { success: false; error: string }> {
  const auth = requireVerifiedTelegramId(telegramId, initData, adminSecret);
  if (!auth.ok) return { success: false, error: auth.error };

  if (!pubkeyHex || !signatureHex) {
    return { success: false, error: 'MISSING_FIELDS' };
  }

  const claimMessage = buildSelfCustodyClaimMessage(telegramId, pubkeyHex);
  const validSignature = await verifySignature(pubkeyHex, claimMessage, signatureHex);
  if (!validSignature) {
    return { success: false, error: 'INVALID_SIGNATURE' };
  }

  try {
    await setSelfCustodyPubkey(telegramId, pubkeyHex);
    return { success: true };
  } catch (err) {
    console.error('[EASTCHAIN] registerSelfCustody error:', err);
    return { success: false, error: 'REGISTER_FAILED' };
  }
}

export async function getSelfCustodyState(telegramId: string, initData: string) {
  const auth = requireVerifiedTelegramId(telegramId, initData);
  if (!auth.ok) return { success: false as const, error: auth.error };

  const state = await getSelfCustodyStatus(telegramId);
  return { success: true as const, ...state };
}

/**
 * Step 2 — apply to be a validator candidate. Requires self-custody to
 * already be registered (checked here, not just trusted from the client)
 * and requires a signature over buildValidatorClaimMessage() using that
 * same self-custody key.
 *
 * Lands as 'pending_review'. This project is admin-approved at this
 * stage on purpose — see reviewValidatorApplication below.
 */
export async function applyAsValidatorCandidate(
  telegramId: string,
  pubkeyHex: string,
  signatureHex: string,
  initData: string,
  adminSecret?: string
): Promise<{ success: true } | { success: false; error: string }> {
  const auth = requireVerifiedTelegramId(telegramId, initData, adminSecret);
  if (!auth.ok) return { success: false, error: auth.error };

  const state = await getSelfCustodyStatus(telegramId);
  if (!state.selfCustodyPubkey) {
    return { success: false, error: 'SELF_CUSTODY_REQUIRED' };
  }
  if (state.selfCustodyPubkey !== pubkeyHex) {
    return { success: false, error: 'PUBKEY_MISMATCH_WITH_SELF_CUSTODY' };
  }

  const claimMessage = buildValidatorClaimMessage(telegramId, pubkeyHex);
  const validSignature = await verifySignature(pubkeyHex, claimMessage, signatureHex);
  if (!validSignature) {
    return { success: false, error: 'INVALID_SIGNATURE' };
  }

  return submitValidatorCandidate(telegramId, pubkeyHex, signatureHex);
}

/**
 * Admin-only — list pending (or all) validator applications for manual
 * review. Gate this behind the same admin check used elsewhere
 * (ADMIN_SECRET) at the call site (e.g. an admin page or route), not here,
 * since this is a plain server action without a request object to read
 * headers from.
 */
export async function getValidatorCandidates(status?: 'pending_review' | 'approved' | 'rejected') {
  return listValidatorCandidates(status);
}

/**
 * Admin-only — approve or reject a candidate. Same caveat as above: gate
 * access at the call site.
 */
export async function reviewValidatorApplication(
  telegramId: string,
  decision: 'approved' | 'rejected',
  reviewedByAdminId: string,
  notes?: string
) {
  await reviewValidatorCandidate(telegramId, decision, reviewedByAdminId, notes);
  return { success: true };
}
