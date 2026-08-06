'use server';

import {
  getExplorerChainState,
  getExplorerRecentBlocks,
  getExplorerAccount,
} from '@/lib/chain-explorer-read';

export async function fetchExplorerChainState() {
  const state = await getExplorerChainState();
  if (!state) return { success: false as const, error: 'chain_unreachable' };
  return { success: true as const, state };
}

export async function fetchExplorerRecentBlocks(limit = 10) {
  const blocks = await getExplorerRecentBlocks(limit);
  return { success: true as const, blocks };
}

export async function fetchExplorerAccount(address: string) {
  const account = await getExplorerAccount(address);
  if (!account) return { success: false as const, error: 'not_found' };
  return { success: true as const, account };
}
