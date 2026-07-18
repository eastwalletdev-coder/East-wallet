"use client";

/**
 * EASTCHAIN — Browser-safe block math
 * ─────────────────────────────────────────────────────────────────────
 * Byte-for-byte mirror of src/lib/consensus/block-math.ts (the version
 * Vercel uses to independently recompute and verify every submission —
 * see leader-schedule.ts's validateAndAcceptProduction()) and of
 * scripts/block-producer-daemon.js (the Node.js reference producer).
 *
 * Node's `crypto` module isn't available in the browser, so this uses
 * Web Crypto (`crypto.subtle.digest`) instead — same SHA-256 algorithm,
 * same payload strings, same '0x'-prefixed lowercase hex output. If this
 * ever drifts from block-math.ts, every Light-Node-produced block gets
 * rejected as a "mismatch" even from an honest node — keep all three
 * copies in sync.
 */

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return "0x" + hex;
}

export async function computeSequenceHash(
  prevBlockHash: string,
  blockIndex: number,
  timestampMs: number
): Promise<string> {
  return sha256Hex(`${prevBlockHash}|${blockIndex}|${timestampMs}`);
}

export async function computeBlockHash(
  prevHash: string,
  blockIndex: number,
  merkleRoot: string,
  timestampMs: number,
  txCount: number
): Promise<string> {
  return sha256Hex(`${prevHash}|${blockIndex}|${merkleRoot}|${timestampMs}|${txCount}`);
}

export async function computeMerkleRoot(txHashes: string[]): Promise<string> {
  if (txHashes.length === 0) return "0x" + "0".repeat(64);
  if (txHashes.length === 1) return txHashes[0];
  let layer = [...txHashes];
  while (layer.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i];
      const right = layer[i + 1] || layer[i];
      next.push(await sha256Hex(left + right));
    }
    layer = next;
  }
  return layer[0];
}

/** Canonical message a producer signs over a hash it computed — verified
 * against the SERVER's own recomputation, never trusted as-is. */
export function buildProductionMessage(proposalId: number, blockIndex: number, blockHash: string): string {
  return `BLOCK_PRODUCE|${proposalId}|${blockIndex}|${blockHash}`;
}
