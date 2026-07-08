/**
 * EASTCHAIN — Light Node reward parameters.
 *
 * Safe to open-source: these are pure economic constants, not secrets.
 * Tune these as adoption grows — nothing else in the codebase needs to
 * change to adjust the reward rate.
 *
 * The actual block count used for a claim is always re-derived and capped
 * server-side (see mining-contract.ts) — a device claiming more verified
 * blocks than this cap is simply capped, never trusted beyond it.
 */

// Paid out per block the device verified during its online session,
// on top of the flat MINING_REWARD (see blockchain.ts) for completing
// the 120s participation window.
export const LIGHTNODE_REWARD_PER_BLOCK = 0.5;

// Hard ceiling on how many verified blocks count toward a single claim,
// regardless of what the client reports. Prevents a modified client from
// claiming an inflated block count.
export const LIGHTNODE_MAX_BLOCKS_PER_CLAIM = 20;
