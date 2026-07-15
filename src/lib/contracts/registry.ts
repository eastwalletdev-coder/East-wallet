/**
 * EASTCHAIN — Contract Registry
 * ─────────────────────────────────────────────────────────────────────
 * Fixed, EVM-style 0x... addresses for each internal "contract".
 * The ABI map below is a WHITELIST: the engine (engine.ts) rejects any
 * (contractAddress, functionName, params) combination that isn't listed
 * here. This closes off the most common injection vector — a client
 * calling an internal function that was never meant to be exposed, or
 * smuggling extra fields into `params` that a handler wasn't expecting.
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
};

export function isKnownCall(contractAddress: string, functionName: string): boolean {
  const abi = CONTRACT_ABI[contractAddress];
  return !!abi && functionName in abi;
}

export function paramsMatchAbi(
  contractAddress: string,
  functionName: string,
  params: Record<string, any>
): boolean {
  const expected = CONTRACT_ABI[contractAddress]?.[functionName];
  if (!expected) return false;
  const given = Object.keys(params);
  if (given.length !== expected.length) return false;
  return expected.every((k) => given.includes(k));
}
