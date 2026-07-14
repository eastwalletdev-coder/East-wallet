/**
 * EASTCHAIN — Chain header signing (server-side)
 * ─────────────────────────────────────────────────────────────────────
 * Closes a gap the R2 archive + Railway relay both share: neither the
 * hash-chain check nor "did this come from the right URL" proves the
 * header was actually produced by Vercel's sealBlock() — someone with a
 * leaked R2 write credential, or a compromised Railway relay, could in
 * principle serve a self-consistent but fake chain to a Light Node.
 *
 * secp256k1 / EVM-compatible: this uses a DEDICATED Ethereum-style keypair
 * (not any user's wallet key, not KEYPAIR_DERIVATION_SECRET-derived, not a
 * validator's self-custody key) to EIP-191 (personal_sign) sign
 * `EASTCHAIN_BLOCK|{height}|{blockHash}` for every sealed block. Chosen
 * over the previous Ed25519 scheme because the project is migrating to be
 * EVM-compatible end to end — same signature format used elsewhere in the
 * app (see evm-signature.ts's verifyEvmOwnership), same tooling (ethers),
 * and directly reusable later if chain-signing ever moves on-chain (e.g.
 * a multisig/contract-based validator set).
 *
 * The signing ADDRESS (not a raw public key) is embedded directly in the
 * Light Node client bundle (NEXT_PUBLIC_CHAIN_SIGNING_ADDRESS) — trusting
 * it is equivalent to trusting the app's own code, the same trust anchor
 * any app already relies on. The private key NEVER leaves Vercel's server
 * environment — not given to Railway, not given to R2, not derivable by
 * anyone who only has KEYPAIR_DERIVATION_SECRET or ADMIN_SECRET.
 *
 * One-time setup: generate a keypair once (see scripts/generate-chain-signing-key.js)
 * and set:
 *   CHAIN_SIGNING_PRIVATE_KEY (server-only, Vercel env)   — 0x-prefixed 32-byte hex
 *   NEXT_PUBLIC_CHAIN_SIGNING_ADDRESS (public, safe to expose) — 0x... EVM address
 */
import { Wallet, hashMessage } from 'ethers';

let cachedWallet: Wallet | null = null;
let warnedUnconfigured = false;

function getSigningWallet(): Wallet | null {
  const pk = process.env.CHAIN_SIGNING_PRIVATE_KEY;
  if (!pk) {
    if (!warnedUnconfigured) {
      // Loud, once — this is easy to miss because sealBlock() never fails
      // when this happens, it just ships unsigned headers, which every
      // Light Node above SIGNING_ENFORCED_FROM_HEIGHT will silently reject.
      console.warn(
        '[EASTCHAIN] CHAIN_SIGNING_PRIVATE_KEY not set — sealed blocks are shipping WITHOUT a signature. ' +
        'Light Nodes will reject them (see lightnode/client.ts verifyHeader). ' +
        'Run scripts/generate-chain-signing-key.js and set CHAIN_SIGNING_PRIVATE_KEY + NEXT_PUBLIC_CHAIN_SIGNING_ADDRESS.'
      );
      warnedUnconfigured = true;
    }
    return null; // not configured — signing disabled, headers ship unsigned
  }
  if (!cachedWallet) {
    try {
      cachedWallet = new Wallet(pk);
    } catch (err) {
      console.error('[EASTCHAIN] CHAIN_SIGNING_PRIVATE_KEY is not a valid secp256k1 private key — signing disabled.', err);
      return null;
    }
  }
  return cachedWallet;
}

export function buildChainSigningMessage(height: number, blockHash: string): string {
  return `EASTCHAIN_BLOCK|${height}|${blockHash}`;
}

/** The address Light Nodes should trust — derived from CHAIN_SIGNING_PRIVATE_KEY, null if unconfigured. */
export function getChainSigningAddress(): string | null {
  return getSigningWallet()?.address ?? null;
}

/**
 * Returns a hex EIP-191 signature (0x + 130 hex chars, r+s+v), or null if
 * CHAIN_SIGNING_PRIVATE_KEY isn't configured — callers should treat null
 * as "ship this header unsigned" (backward compatible with the
 * archive/relay running before this feature existed), never as a hard
 * failure that blocks sealing.
 *
 * Synchronous on purpose (signingKey.sign is local/offline math, no
 * network) so callers in block-engine.ts don't need to change to `await`.
 */
export function signChainHeader(height: number, blockHash: string): string | null {
  const wallet = getSigningWallet();
  if (!wallet) return null;
  const message = buildChainSigningMessage(height, blockHash);
  const digest = hashMessage(message); // EIP-191 prefixed keccak256
  return wallet.signingKey.sign(digest).serialized; // 0x-prefixed 65-byte compact sig
}
