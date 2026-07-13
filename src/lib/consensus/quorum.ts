/**
 * EASTCHAIN — Recovery vote quorum
 * ─────────────────────────────────────────────────────────────────────
 * FIXES A BUG: quorum was hardcoded to a fixed number (7) in both
 * validator-contract.ts and /api/consensus/route.ts, independently.
 * Whenever fewer than 7 validators were actually active, quorum became
 * mathematically unreachable — votes recorded successfully but the
 * network status never flipped back to 'active', so the vote prompt
 * kept resurfacing even though every individual vote "worked".
 *
 * Quorum is now a simple majority of CURRENTLY active validators,
 * recomputed every time — not a fixed number assuming a specific
 * validator set size. This is majority-based crash-recovery consensus
 * (see the BFT vs. crash-fault distinction discussed for this project),
 * not a Byzantine-tolerant supermajority — appropriate for this feature,
 * which recovers from a halted primary, not from a lying validator.
 */
export function computeRequiredQuorum(totalActiveValidators: number): number {
  if (totalActiveValidators <= 0) return 1; // no validators — nothing can reach quorum anyway
  return Math.floor(totalActiveValidators / 2) + 1; // simple majority
}
