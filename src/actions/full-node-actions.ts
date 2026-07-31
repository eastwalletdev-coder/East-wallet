'use server';

import { validateTelegramData, extractVerifiedUserId } from '@/lib/telegram';
import { hasAgreedToFullNodeTerms, recordFullNodeAgreement, setFullNodeActive, getLatestSyncAttestation, insertSyncAttestation } from '@/lib/db/identity';
import { verifyEvmOwnership } from '@/lib/evm-signature';
import { buildFullNodeSyncPayload } from '@/lib/tx-payload-builders';
import { notifyHubSyncAttestation } from '@/lib/hub-notify';
import { ledgerPool } from '@/lib/db/ledger';

// Guards against a stale/replayed signature being submitted long after
// signing — 5 minutes is generous for normal network latency while still
// meaning a leaked old signature can't be replayed indefinitely.
const ATTESTATION_MAX_AGE_MS = 5 * 60 * 1000;

// Below this height, a "regression" isn't meaningful — everyone starts at
// 0 once, and small fluctuations near genesis aren't a signal of anything.
const SIGNIFICANT_HEIGHT_THRESHOLD = 10;

async function getCurrentChainGenesisTimestamp(): Promise<Date | null> {
  const client = await ledgerPool.connect();
  try {
    const res = await client.query(
      'SELECT created_at FROM ledger.blocks ORDER BY chain_seq ASC LIMIT 1'
    );
    return res.rows.length ? new Date(res.rows[0].created_at) : null;
  } finally {
    client.release();
  }
}

export async function submitSyncAttestation(
  tgId: string,
  walletAddress: string,
  nodeId: string,
  height: number,
  signedAt: number,
  signature: string,
  initData?: string
) {
  if (!initData || !validateTelegramData(initData)) return { success: false, error: 'IDENTITY_VIOLATION' };
  const verifiedId = extractVerifiedUserId(initData);
  if (verifiedId !== tgId) return { success: false, error: 'IDENTITY_MISMATCH' };

  if (Math.abs(Date.now() - signedAt) > ATTESTATION_MAX_AGE_MS) {
    return { success: false, error: 'ATTESTATION_EXPIRED_OR_CLOCK_SKEW' };
  }
  if (!Number.isFinite(height) || height < 0) {
    return { success: false, error: 'INVALID_HEIGHT' };
  }

  const payload = buildFullNodeSyncPayload(nodeId, walletAddress, height, signedAt);
  if (!verifyEvmOwnership(walletAddress, payload, signature)) {
    return { success: false, error: 'INVALID_SIGNATURE' };
  }

  const previous = await getLatestSyncAttestation(tgId);

  // Detection: was there a LEGITIMATE chain-wide genesis reset between the
  // previous attestation and now? If so, everyone's height dropping to ~0
  // is expected and this attestation is NOT suspicious no matter how far
  // it regressed. Only flag when the drop can't be explained that way.
  let flaggedSuspicious = false;
  if (previous && Number(previous.height) >= SIGNIFICANT_HEIGHT_THRESHOLD && height < Number(previous.height) * 0.1) {
    const genesisAt = await getCurrentChainGenesisTimestamp();
    const explainedByReset = genesisAt && new Date(previous.created_at) < genesisAt;
    if (!explainedByReset) {
      flaggedSuspicious = true;
    }
  }

  await insertSyncAttestation({
    telegramId: tgId,
    walletAddress: walletAddress.toLowerCase(),
    nodeId,
    height,
    signedAt,
    signature,
    flaggedSuspicious,
  });

  // Relay to the hub so connected peers get a copy too — see
  // notifyHubSyncAttestation's doc comment for why that matters.
  notifyHubSyncAttestation({ walletAddress: walletAddress.toLowerCase(), nodeId, height, signedAt, signature });

  return { success: true, flaggedSuspicious };
}

/**
 * EASTCHAIN — Full Lightnode consent + sync-attestation actions
 * ─────────────────────────────────────────────────────────────────────
 * checkFullNodeAgreement/agreeToFullNodeTerms/setFullNodeActiveStatus back
 * FullNodeConsentDialog.tsx. Recording agreement requires a valid Telegram
 * session (same as every other identity-sensitive action in this app) — a
 * client can't just POST "I agreed" for an arbitrary telegramId.
 *
 * submitSyncAttestation implements the reset-detection scheme: a user
 * signs (with their own wallet key, client-side) a claim of "as of this
 * timestamp, my full node was at this height", verified here and checked
 * for a suspicious regression vs their previous attestation. See
 * identity.ts's full_node_sync_attestations table doc comment for the full
 * design, and hub-notify.ts's notifyHubSyncAttestation for how peers (not
 * just this server) end up with a copy too.
 *
 * Scope note: this only DETECTS and FLAGS a suspicious regression — no
 * automatic sanctions (slashing/suspension/ban) are applied anywhere in
 * this file. Flagged rows are queryable via listSuspiciousFullNodeResets()
 * for manual review; automated enforcement is a deliberately separate,
 * not-yet-made decision.
 */
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
