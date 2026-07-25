/**
 * EASTCHAIN — Contract Registry (CLIENT-SAFE — no server-only imports)
 * ─────────────────────────────────────────────────────────────────────
 * Fixed, EVM-style 0x... addresses for each internal "contract", plus the
 * ABI whitelist map. Imported by BOTH client components (e.g.
 * WalletConnectRequestHandler.tsx needs EAST_CHAIN_ID) and server code
 * (engine.ts, contract-actions.ts) — so this file must never import
 * anything that pulls in Node-only modules (the 'pg' driver, etc.). The
 * DB-backed half of the whitelist check (isKnownCall/paramsMatchAbi) lives
 * in ./abi-gate.ts instead, imported only by engine.ts (server-only).
 *
 * TWO TIERS of whitelist, checked by isKnownCall()/paramsMatchAbi() in
 * ./abi-gate.ts:
 *  1. CONTRACT_ABI below — static, launch-time functions. Reviewed by a
 *     human at merge time, not by on-chain vote (there's no bootstrapping
 *     a vote before any voting mechanism exists).
 *  2. identity.approved_contract_functions — functions added AFTER
 *     launch, gated behind a validator quorum vote. See
 *     governance-contract.ts (CONTRACTS.GOVERNANCE) for the propose/vote
 *     flow. A function's handler code can already exist in e.g.
 *     staking-contract.ts and still be completely uncallable — same
 *     UNKNOWN_CONTRACT_FUNCTION error as if it didn't exist — until it's
 *     approved here.
 */

// EIP-155 chain ID for EAST, reserved on ChainList/ethereum-lists ahead of
// mainnet. NOT enforced anywhere yet — evm-signature.ts currently only does
// personal_sign (EIP-191) ownership proofs, which don't embed a chain ID.
// This becomes load-bearing once raw tx signing or EIP-712 typed data is
// added; wire it in there rather than hardcoding 172026 again elsewhere.
export const EAST_CHAIN_ID = 172026;

export const CONTRACTS = {
  STAKING: '0x0000000000000000000000000000000000c001',
  VESTING: '0x0000000000000000000000000000000000c002',
  MINING: '0x0000000000000000000000000000000000c003',
  VALIDATOR: '0x0000000000000000000000000000000000c004',
  GOVERNANCE: '0x0000000000000000000000000000000000c005',
} as const;

export type ContractAddress = (typeof CONTRACTS)[keyof typeof CONTRACTS];


/**
 * function name -> exact list of required param keys (order-independent).
 * The engine rejects calls with missing OR extra keys.
 */
export const CONTRACT_ABI: Record<string, Record<string, string[]>> = {
  [CONTRACTS.STAKING]: {
    stake: ['amount'],
    unstake: [],
    requestUnstake: ['amount'],
    claimUnstake: [],
    claimStakingReward: [],
  },
  [CONTRACTS.VESTING]: {
    claimVested: [],
  },
  [CONTRACTS.MINING]: {
    claimMiningReward: ['verifiedHeaders'],
  },
  [CONTRACTS.VALIDATOR]: {
    vote: ['roundId', 'vote'],
  },
  [CONTRACTS.GOVERNANCE]: {
    proposeFunction: ['contractAddress', 'functionName', 'paramKeys'],
    voteOnProposal: ['proposalId', 'vote'],
  },
};
