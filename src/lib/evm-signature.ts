/**
 * EASTCHAIN — EVM signature verification (server-side)
 * ─────────────────────────────────────────────────────────────────────
 * Verifies a personal_sign (EIP-191) signature against a claimed
 * address — used to prove a user really holds the private key for the
 * self-custody EVM address they're registering, without the server
 * ever touching that private key.
 */

import { verifyMessage } from 'ethers';

export function verifyEvmOwnership(address: string, payload: string, signature: string): boolean {
  try {
    const recovered = verifyMessage(payload, signature);
    return recovered.toLowerCase() === address.toLowerCase();
  } catch {
    return false;
  }
}

export function isValidEvmAddress(address: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(address);
}
