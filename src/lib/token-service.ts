"use server"

/**
 * @fileOverview Real on-chain balance fetching, using the RPC endpoints
 * already configured/pinged in rpc-context.tsx. Previously this entire
 * file was a stub (fake delay + hardcoded '0.00' balances) that never
 * actually called the RPC layer that was already built and working.
 *
 * Native token balances (ETH, SOL, BNB, Base ETH) need no contract
 * address — fetched directly via eth_getBalance / getBalance.
 *
 * ERC20/SPL token balances need a verified contract/mint address. Only
 * tokens with an address I could verify against an official source
 * (Etherscan/BaseScan/Circle docs) are marked comingSoon: false below —
 * everything else stays comingSoon: true rather than risk showing a
 * balance from an unverified/wrong address. See each entry's comment
 * for the source.
 */

export type Token = {
  name: string;
  symbol: string;
  balance: string;
  value: string;
  change: string;
  logoURI: string;
  imageHint: string;
  chain: 'East' | 'Ethereum' | 'Solana' | 'Base' | 'BSC';
  contractAddress?: string;
  decimals?: number;
  isCustom?: boolean;
  /** True = not yet wired to a verified on-chain source — see file header. */
  comingSoon?: boolean;
};

const TOKEN_LIBRARY: Token[] = [
  // ── East (native, 6 decimals) ────────────────────────────────
  { name: 'East', symbol: 'EAST', balance: '0.00', value: '$0.00', change: '+0.00%', chain: 'East', logoURI: '/east-logo.png', imageHint: 'east chain logo', decimals: 6, comingSoon: false },
  // ── Ethereum ──────────────────────────────────────────────────────
  { name: 'Ethereum', symbol: 'ETH', balance: '0.00', value: '$0.00', change: '+0.00%', chain: 'Ethereum', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png', imageHint: 'ethereum logo', decimals: 18, comingSoon: false },
  // WBTC — verified via Etherscan: 0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599
  { name: 'Wrapped BTC', symbol: 'WBTC', balance: '0.00', value: '$0.00', change: '+0.00%', chain: 'Ethereum', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/bitcoin/info/logo.png', imageHint: 'bitcoin logo', contractAddress: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', decimals: 8, comingSoon: false },
  // USDC — verified via Circle's official contract address docs
  { name: 'USD Coin', symbol: 'USDC', balance: '0.00', value: '$0.00', change: '+0.00%', chain: 'Ethereum', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png', imageHint: 'usdc coin', contractAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6, comingSoon: false },
  // USDT — verified via Etherscan
  { name: 'Tether USD', symbol: 'USDT', balance: '0.00', value: '$0.00', change: '+0.00%', chain: 'Ethereum', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png', imageHint: 'tether logo', contractAddress: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6, comingSoon: false },

  // ── Base ──────────────────────────────────────────────────────────
  { name: 'Base ETH', symbol: 'ETH', balance: '0.00', value: '$0.00', change: '+0.00%', chain: 'Base', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png', imageHint: 'ethereum logo', decimals: 18, comingSoon: false },
  // USDC on Base — verified via BaseScan
  { name: 'Base USDC', symbol: 'USDC', balance: '0.00', value: '$0.00', change: '+0.00%', chain: 'Base', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png', imageHint: 'usdc coin', contractAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6, comingSoon: false },
  // AERO — address not independently verified this session, left as comingSoon
  { name: 'Aerodrome', symbol: 'AERO', balance: '0.00', value: '$0.00', change: '+0.00%', chain: 'Base', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/base/assets/0x940181a94A35A4569E4529A3CDfB74e38FD98631/logo.png', imageHint: 'aerodrome logo', comingSoon: true },

  // ── Solana ────────────────────────────────────────────────────────
  { name: 'Solana', symbol: 'SOL', balance: '0.00', value: '$0.00', change: '+0.00%', chain: 'Solana', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/info/logo.png', imageHint: 'solana logo', decimals: 9, comingSoon: false },
  // USDC-SOL — verified via Circle's official mint address docs
  { name: 'Solana USDC', symbol: 'USDC', balance: '0.00', value: '$0.00', change: '+0.00%', chain: 'Solana', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png', imageHint: 'usdc coin', contractAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6, comingSoon: false },
  { name: 'Jupiter', symbol: 'JUP', balance: '0.00', value: '$0.00', change: '+0.00%', chain: 'Solana', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/assets/JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN/logo.png', imageHint: 'jupiter logo', comingSoon: true },
  { name: 'Bonk', symbol: 'BONK', balance: '0.00', value: '$0.00', change: '+0.00%', chain: 'Solana', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/assets/DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263/logo.png', imageHint: 'bonk logo', comingSoon: true },

  // ── BSC ───────────────────────────────────────────────────────────
  { name: 'Binance Coin', symbol: 'BNB', balance: '0.00', value: '$0.00', change: '+0.00%', chain: 'BSC', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/binance/info/logo.png', imageHint: 'binance logo', decimals: 18, comingSoon: false },
  // BUSD/CAKE — addresses not independently verified this session, left as comingSoon
  { name: 'BUSD', symbol: 'BUSD', balance: '0.00', value: '$0.00', change: '+0.00%', chain: 'BSC', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x4Fabb145d64652a948d72533023f6E7A623C7C53/logo.png', imageHint: 'busd token', comingSoon: true },
  { name: 'PancakeSwap', symbol: 'CAKE', balance: '0.00', value: '$0.00', change: '+0.00%', chain: 'BSC', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/assets/0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82/logo.png', imageHint: 'pancakeswap logo', comingSoon: true },
  { name: 'BSC USDT', symbol: 'USDT', balance: '0.00', value: '$0.00', change: '+0.00%', chain: 'BSC', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png', imageHint: 'tether logo', comingSoon: true },
];

const NATIVE_SYMBOL_BY_CHAIN: Record<string, string> = { East: 'EAST', Ethereum: 'ETH', Base: 'ETH', BSC: 'BNB', Solana: 'SOL' };

async function rpcCall(url: string, method: string, params: any[]): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(6000),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'RPC error');
  return json.result;
}

/** ERC20 balanceOf(address) — 0x70a08231 is the standard 4-byte selector. */
async function fetchErc20Balance(rpcUrl: string, contractAddress: string, ownerAddress: string, decimals: number): Promise<number> {
  const paddedAddress = ownerAddress.replace(/^0x/, '').padStart(64, '0');
  const data = `0x70a08231${paddedAddress}`;
  const result = await rpcCall(rpcUrl, 'eth_call', [{ to: contractAddress, data }, 'latest']);
  const raw = BigInt(result || '0x0');
  return Number(raw) / 10 ** decimals;
}

async function fetchNativeEvmBalance(rpcUrl: string, address: string, decimals = 18): Promise<number> {
  const result = await rpcCall(rpcUrl, 'eth_getBalance', [address, 'latest']);
  const raw = BigInt(result || '0x0');
  return Number(raw) / 10 ** decimals;
}

async function fetchSolNativeBalance(rpcUrl: string, address: string): Promise<number> {
  const result = await rpcCall(rpcUrl, 'getBalance', [address]);
  const lamports = typeof result === 'object' ? result.value : result;
  return (lamports || 0) / 1e9;
}

async function fetchSplTokenBalance(rpcUrl: string, mintAddress: string, ownerAddress: string): Promise<number> {
  const result = await rpcCall(rpcUrl, 'getTokenAccountsByOwner', [
    ownerAddress,
    { mint: mintAddress },
    { encoding: 'jsonParsed' },
  ]);
  const accounts = result?.value || [];
  return accounts.reduce((sum: number, acc: any) => {
    const uiAmount = acc?.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0;
    return sum + uiAmount;
  }, 0);
}

/**
 * Fetches real balances for every token on `chain`, using `rpcUrl` (the
 * currently-selected live RPC endpoint from rpc-context.tsx). Falls back
 * to '0.00' + comingSoon for any token whose fetch fails or whose
 * contract address isn't verified — never silently shows a stale/fake
 * number as if it were real.
 */
export async function scanTokensForAddress(
  address: string,
  chain: 'East' | 'Ethereum' | 'Solana' | 'Base' | 'BSC',
  rpcUrl?: string
): Promise<Token[]> {
  const chainTokens = TOKEN_LIBRARY.filter(t => t.chain === chain);
  if (!rpcUrl || !address) {
    return chainTokens.map(t => ({ ...t, comingSoon: true })); // no live RPC selected yet — show as pending, not fake data
  }

  const results = await Promise.all(chainTokens.map(async (token) => {
    if (token.comingSoon) return token; // unverified contract address — don't attempt a fetch

    try {
      let balance: number;
      const isNative = token.symbol === NATIVE_SYMBOL_BY_CHAIN[chain] && !token.contractAddress;

      if (chain === 'Solana') {
        balance = isNative
          ? await fetchSolNativeBalance(rpcUrl, address)
          : await fetchSplTokenBalance(rpcUrl, token.contractAddress!, address);
      } else {
        const nativeDecimals = chain === 'East' ? 6 : 18;
        balance = isNative
          ? await fetchNativeEvmBalance(rpcUrl, address, nativeDecimals)
          : await fetchErc20Balance(rpcUrl, token.contractAddress!, address, token.decimals || 18);
      }

      return { ...token, balance: balance.toFixed(token.symbol === 'BTC' || token.symbol === 'WBTC' ? 6 : 4) };
    } catch (err) {
      console.error(`[EASTCHAIN] Balance fetch failed for ${token.symbol} on ${chain}:`, err);
      return { ...token, balance: '—' }; // fetch failed — show a dash, not a misleading 0.00
    }
  }));

  return results;
}

/**
 * Fetches the base token library for swapping.
 */
export async function getTokenLibrary(chain: 'East' | 'Ethereum' | 'Solana' | 'Base' | 'BSC'): Promise<Token[]> {
  return TOKEN_LIBRARY.filter(token => token.chain === chain);
}
