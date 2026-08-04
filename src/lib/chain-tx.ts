/**
 * EASTCHAIN — on-chain transaction helpers (east-validator via Hub gateway)
 *
 * Builds the exact JSON surface the Go validator hashes for EIP-191:
 *   SHA256( json({type,from,to,amount,nonce,timestamp}) )
 * then signs: personal_sign("EASTCHAIN_TX|{hash}")
 *
 * Submit path (browser → Vercel → Hub → Validator):
 *   POST /api/chain/tx  →  Hub POST /rpc/tx  →  Validator POST /tx
 *
 * Amounts for transfer / stake are 6-decimal subunits (1 EAST = 1_000_000).
 */

export const SUBUNITS_PER_EAST = 1_000_000;

export type ChainTxType =
  | "transfer"
  | "stake"
  | "request_unstake"
  | "claim_unstake"
  | "claim_mining";

export type ChainTxBody = {
  type: ChainTxType;
  from: string;
  to: string;
  amount: number; // int64 subunits for transfer/stake; human EAST for claim_mining
  nonce: number;
  timestamp: number; // unix ms
  signature: string; // 0x + 65-byte EIP-191
  payload?: unknown;
};

/** Must match Go encoding/json field order on the hashable struct in internal/tx/tx.go */
export function buildChainTxHashable(params: {
  type: ChainTxType;
  from: string;
  to: string;
  amount: number;
  nonce: number;
  timestamp: number;
}): string {
  const from = params.from.toLowerCase();
  const to = (params.to || "").toLowerCase();
  // Compact JSON, key order identical to Go struct tags order
  return JSON.stringify({
    type: params.type,
    from,
    to,
    amount: params.amount,
    nonce: params.nonce,
    timestamp: params.timestamp,
  });
}

export async function hashChainTxPayload(jsonPayload: string): Promise<string> {
  const data = new TextEncoder().encode(jsonPayload);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Message string the wallet must personal_sign (ethers signMessage). */
export function buildEastchainTxMessage(txHashHex: string): string {
  return `EASTCHAIN_TX|${txHashHex}`;
}

export function humanEastToSubunits(amount: number): number {
  // Avoid float drift for typical UI amounts (up to ~9 decimals input)
  return Math.round(amount * SUBUNITS_PER_EAST);
}

export function subunitsToHumanEast(subunits: number): number {
  return subunits / SUBUNITS_PER_EAST;
}

/**
 * Whether the UI should submit EAST sends/stakes to the chain (Hub → validator)
 * instead of the legacy Neon mempool path.
 *
 * Default: ON (on-chain only). Set NEXT_PUBLIC_USE_CHAIN_TX=false only to
 * force the old Neon path. Wallet Send / EASTPASS must not debit Neon for
 * normal transfers.
 */
export function useChainTxEnabled(): boolean {
  if (typeof process === "undefined") return true;
  const v =
    process.env.NEXT_PUBLIC_USE_CHAIN_TX ||
    process.env.USE_CHAIN_TX ||
    "";
  // Explicit off only
  if (v === "false" || v === "0") return false;
  // Default true when unset / "true" / "1"
  return true;
}
