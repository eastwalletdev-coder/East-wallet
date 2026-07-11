/**
 * EASTCHAIN — Chain header signing (server-side)
 * ─────────────────────────────────────────────────────────────────────
 * Closes a gap the R2 archive + Railway relay both share: neither the
 * hash-chain check nor "did this come from the right URL" proves the
 * header was actually produced by Vercel's sealBlock() — someone with a
 * leaked R2 write credential, or a compromised Railway relay, could in
 * principle serve a self-consistent but fake chain to a Light Node.
 *
 * This uses a DEDICATED Ed25519 keypair (not any user's wallet key, not
 * KEYPAIR_DERIVATION_SECRET-derived, not a validator's self-custody key)
 * to sign `EASTCHAIN_BLOCK|{height}|{blockHash}` for every sealed block.
 * The public half is embedded directly in the Light Node client bundle
 * (NEXT_PUBLIC_CHAIN_SIGNING_PUBLIC_KEY) — trusting it is equivalent to
 * trusting the app's own code, the same trust anchor any app already
 * relies on. The private half NEVER leaves Vercel's server environment —
 * not given to Railway, not given to R2, not derivable by anyone who
 * only has KEYPAIR_DERIVATION_SECRET or ADMIN_SECRET.
 *
 * One-time setup: generate a keypair once (see scripts/generate-chain-signing-key.js)
 * and set:
 *   CHAIN_SIGNING_PRIVATE_KEY (server-only, Vercel env)  — the seed, hex
 *   NEXT_PUBLIC_CHAIN_SIGNING_PUBLIC_KEY (public, safe to expose) — hex
 */
import nacl from 'tweetnacl';

let cachedKeypair: nacl.SignKeyPair | null = null;

function getSigningKeypair(): nacl.SignKeyPair | null {
  const seedHex = process.env.CHAIN_SIGNING_PRIVATE_KEY;
  if (!seedHex) return null; // not configured — signing disabled, headers ship unsigned
  if (!cachedKeypair) {
    const seed = new Uint8Array(Buffer.from(seedHex, 'hex'));
    if (seed.length !== 32) {
      console.error('[EASTCHAIN] CHAIN_SIGNING_PRIVATE_KEY must be a 32-byte hex seed — signing disabled.');
      return null;
    }
    cachedKeypair = nacl.sign.keyPair.fromSeed(seed);
  }
  return cachedKeypair;
}

export function buildChainSigningMessage(height: number, blockHash: string): string {
  return `EASTCHAIN_BLOCK|${height}|${blockHash}`;
}

/**
 * Returns a hex signature, or null if CHAIN_SIGNING_PRIVATE_KEY isn't
 * configured — callers should treat null as "ship this header unsigned"
 * (backward compatible with the archive/relay running before this
 * feature existed), never as a hard failure that blocks sealing.
 */
export function signChainHeader(height: number, blockHash: string): string | null {
  const kp = getSigningKeypair();
  if (!kp) return null;
  const message = buildChainSigningMessage(height, blockHash);
  const sig = nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey);
  return Buffer.from(sig).toString('hex');
}
