'use server';

/**
 * Read on-chain account for a self-custody EVM address (vault).
 * Returns human EAST (already ÷ 1e6). Does not touch Neon.
 */
import { fetchChainAccount } from '@/lib/chain-balance';

export async function getChainAccountForAddress(address: string) {
  if (!address || !address.startsWith('0x')) {
    return { success: false as const, error: 'address required (0x...)' };
  }
  const account = await fetchChainAccount(address);
  if (!account) {
    return { success: false as const, error: 'validator_unreachable_or_empty' };
  }
  return {
    success: true as const,
    balance: account.balance,
    staked: account.staked,
    pendingUnstake: account.pendingUnstake,
    nonce: account.nonce,
    source: account.source,
  };
}
