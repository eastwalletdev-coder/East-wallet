'use server';

/**
 * EASTCHAIN — Wallet Export Action
 * Reveals a user's mnemonic + private keys so they can import EAST
 * elsewhere (Phantom, MetaMask, etc). This is the single most sensitive
 * action in the app — treat every line here as security-critical.
 */

import { validateTelegramData, extractVerifiedUserId } from '@/lib/telegram';
import { checkExportCooldown, setExportCooldown } from '@/lib/db/redis';
import { exportWalletForUser, type EastWalletExport } from '@/lib/keypair-service';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

export async function exportWalletSecrets(
  telegramId: string,
  initData: string
): Promise<
  | { success: true; wallet: EastWalletExport }
  | { success: false; error: string; remainingSeconds?: number }
> {
  // 1. Identity must be cryptographically verified against Telegram's own
  //    signature — never trust a client-supplied telegramId on its own.
  if (IS_PRODUCTION) {
    if (!initData || !validateTelegramData(initData)) {
      return { success: false, error: 'IDENTITY_VIOLATION' };
    }
    const verifiedId = extractVerifiedUserId(initData);
    if (!verifiedId || verifiedId !== telegramId) {
      return { success: false, error: 'IDENTITY_MISMATCH' };
    }
  }

  // 2. Throttle — exporting a private key should never be hammerable.
  const cooldown = await checkExportCooldown(telegramId);
  if (!cooldown.allowed) {
    return { success: false, error: 'RATE_LIMITED', remainingSeconds: cooldown.remainingSeconds };
  }
  await setExportCooldown(telegramId);

  try {
    const wallet = await exportWalletForUser(telegramId);
    // Do NOT console.log(wallet) or any of its fields, here or upstream.
    return { success: true, wallet };
  } catch (err) {
    console.error('[EASTCHAIN] Wallet export error (details withheld from logs)');
    return { success: false, error: 'EXPORT_FAILED' };
  }
}
