/**
 * EASTCHAIN — Block math (pure functions, no I/O)
 * ─────────────────────────────────────────────────────────────────────
 * Extracted out of block-engine.ts so BOTH Vercel (for verification) and
 * the external producer daemon (scripts/block-producer-daemon.js, for
 * production) compute hashes with the exact same algorithm. If these
 * ever drift apart, every externally-produced block would get rejected
 * as a "mismatch" even from an honest node — keep this file as the
 * single source of truth and mirror it byte-for-byte in the JS daemon.
 */
import { createHash } from 'crypto';

export function computeSequenceHash(
  prevBlockHash: string,
  blockIndex: number,
  timestampMs: number
): string {
  const payload = `${prevBlockHash}|${blockIndex}|${timestampMs}`;
  return '0x' + createHash('sha256').update(payload).digest('hex');
}

export function computeBlockHash(
  prevHash: string,
  blockIndex: number,
  merkleRoot: string,
  timestampMs: number,
  txCount: number
): string {
  const payload = `${prevHash}|${blockIndex}|${merkleRoot}|${timestampMs}|${txCount}`;
  return '0x' + createHash('sha256').update(payload).digest('hex');
}

export function computeMerkleRoot(txHashes: string[]): string {
  if (txHashes.length === 0) return '0x' + '0'.repeat(64);
  if (txHashes.length === 1) return txHashes[0];
  let layer = [...txHashes];
  while (layer.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i];
      const right = layer[i + 1] || layer[i];
      next.push('0x' + createHash('sha256').update(left + right).digest('hex'));
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

/** Max allowed clock drift between the producing node's timestamp and
 * Vercel's own clock — generous enough for real-world NTP drift, tight
 * enough to catch a node backdating/future-dating a block. */
export const MAX_PRODUCTION_CLOCK_SKEW_MS = 30_000;
