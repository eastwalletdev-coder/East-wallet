'use server';

/**
 * EASTCHAIN — Full Lightnode consent actions
 * ─────────────────────────────────────────────────────────────────────
 * Backs FullNodeConsentDialog.tsx. Recording agreement requires a valid
 * Telegram session (same as every other identity-sensitive action in this
 * app) — a client can't just POST "I agreed" for an arbitrary telegramId.
 *
 * Scope note: this only records consent + registration. No slashing or
 * violation-detection logic exists yet — that's explicitly deferred to a
 * future design pass (needs a real scheme for detecting "this full node's
 * replica went missing/reset," which is a harder problem than it sounds:
 * a node going offline normally and a node whose owner wiped their data
 * look identical from the hub's side without more signal than exists
 * today).
 */
import { validateTelegramData, extractVerifiedUserId } from '@/lib/telegram';
import { hasAgreedToFullNodeTerms, recordFullNodeAgreement, setFullNodeActive } from '@/lib/db/identity';

export async function checkFullNodeAgreement(tgId: string, initData?: string) {
  if (!initData || !validateTelegramData(initData)) return { success: false, error: 'IDENTITY_VIOLATION' };
  const verifiedId = extractVerifiedUserId(initData);
  if (verifiedId !== tgId) return { success: false, error: 'IDENTITY_MISMATCH' };

  const agreed = await hasAgreedToFullNodeTerms(tgId);
  return { success: true, agreed };
}

export async function agreeToFullNodeTerms(tgId: string, nodeId: string, initData?: string) {
  if (!initData || !validateTelegramData(initData)) return { success: false, error: 'IDENTITY_VIOLATION' };
  const verifiedId = extractVerifiedUserId(initData);
  if (verifiedId !== tgId) return { success: false, error: 'IDENTITY_MISMATCH' };
  if (!nodeId) return { success: false, error: 'MISSING_NODE_ID' };

  await recordFullNodeAgreement(tgId, nodeId);
  return { success: true };
}

export async function setFullNodeActiveStatus(tgId: string, isActive: boolean, initData?: string) {
  if (!initData || !validateTelegramData(initData)) return { success: false, error: 'IDENTITY_VIOLATION' };
  const verifiedId = extractVerifiedUserId(initData);
  if (verifiedId !== tgId) return { success: false, error: 'IDENTITY_MISMATCH' };

  await setFullNodeActive(tgId, isActive);
  return { success: true };
}
