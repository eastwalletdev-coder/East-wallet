/**
 * EASTCHAIN — Light Node reward parameters.
 *
 * Safe to open-source: these are pure economic constants, not secrets.
 * Tune these as adoption grows — nothing else in the codebase needs to
 * change to adjust the reward rate.
 *
 * NOTE: the per-block bonus (LIGHTNODE_REWARD_PER_BLOCK) has been removed.
 * Light Node rewards are now paid per *epoch* (see mining-contract.ts),
 * and the epoch count used for a claim is always re-derived server-side
 * from ledger.chain_meta.epoch_count — never taken from client-reported
 * numbers. This closes the manipulation gap the old per-block bonus had
 * (a modified client could report an inflated verifiedHeaders count).
 */

// Paid out per epoch elapsed since the user's last claim, on top of the
// flat MINING_REWARD (see blockchain.ts). Computed purely from the
// server's own epoch counter — the client cannot influence this number.
export const LIGHTNODE_EPOCH_BONUS = 0.1;

// Hard ceiling on how many elapsed epochs count toward a single claim.
// If a user hasn't claimed in a very long time, they still only get
// credit for the most recent 100 epochs — prevents unbounded payouts
// from a long-dormant account and keeps the cap meaningful regardless
// of how it's computed.
export const LIGHTNODE_MAX_EPOCHS_PER_CLAIM = 100;
