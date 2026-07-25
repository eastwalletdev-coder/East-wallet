/**
 * EASTCHAIN — Contract Registry
 * ─────────────────────────────────────────────────────────────────────
 * Fixed, EVM-style 0x... addresses for each internal "contract".
 * The ABI map below is a WHITELIST: the engine (engine.ts) rejects any
 * (contractAddress, functionName, params) combination that isn't listed
 * here. This closes off the most common injection vector — a client
 * calling an internal function that was never meant to be exposed, or
 * smuggling extra fields into `params` that a handler wasn't expecting.
 *
 * TWO TIERS of whitelist, checked by isKnownCall()/paramsMatchAbi():
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
import { identityPool } from '@/lib/db/identity';

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

export async function isKnownCall(contractAddress: string, functionName: string): Promise<boolean> {
  const abi = CONTRACT_ABI[contractAddress];
  if (abi && functionName in abi) return true;
  // Tier 2 — governance-approved functions (see module doc comment above).
  const res = await identityPool.query(
    'SELECT 1 FROM identity.approved_contract_functions WHERE contract_address = $1 AND function_name = $2',
    [contractAddress, functionName]
  );
  return res.rows.length > 0;
}

export async function paramsMatchAbi(
  contractAddress: string,
  functionName: string,
  params: Record<string, any>
): Promise<boolean> {
  let expected = CONTRACT_ABI[contractAddress]?.[functionName];
  if (!expected) {
    const res = await identityPool.query(
      'SELECT param_keys FROM identity.approved_contract_functions WHERE contract_address = $1 AND function_name = $2',
      [contractAddress, functionName]
    );
    if (!res.rows.length) return false;
    expected = res.rows[0].param_keys as string[]; // JSONB — pg already parses this to a JS array
  }
  const given = Object.keys(params);
  if (given.length !== expected.length) return false;
  return expected.every((k) => given.includes(k));
}
