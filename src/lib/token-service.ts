"use server"

/**
 * @fileOverview Service to manage a rich library of token assets across different chains.
 * Optimized for performance and auto-discovery. Clean state for fresh wallets.
 */

export type Token = {
  name: string;
  symbol: string;
  balance: string;
  value: string;
  change: string;
  logoURI: string;
  imageHint: string;
  chain: 'Ethereum' | 'Solana' | 'Base' | 'BSC';
  contractAddress?: string;
  isCustom?: boolean;
};

const TOKEN_LIBRARY: Token[] = [
  // Ethereum Tokens
  { name: 'Ethereum', symbol: 'ETH', balance: '0.00', value: '$0.00', change: '+0.00%', chain: 'Ethereum', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png', imageHint: 'ethereum logo' },
  { name: 'Wrapped BTC', symbol: 'WBTC', balance: '0.00', value: '$0.00', change: '+0.00%', chain: 'Ethereum', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/bitcoin/info/logo.png', imageHint: 'bitcoin logo' },
  { name: 'USD Coin', symbol: 'USDC', balance: '0.00', value: '$0.00', change: '+0.00%', chain: 'Ethereum', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png', imageHint: 'usdc coin' },
  { name: 'Tether USD', symbol: 'USDT', balance: '0.00', value: '$0.00', change: '+0.00%', chain: 'Ethereum', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png', imageHint: 'tether logo' },
  
  // Base Tokens
  { name: 'Base ETH', symbol: 'ETH', balance: '0.00', value: '$0.00', change: '+0.00%', chain: 'Base', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png', imageHint: 'ethereum logo' },
  { name: 'Base USDC', symbol: 'USDC', balance: '0.00', value: '$0.00', change: '+0.00%', chain: 'Base', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png', imageHint: 'usdc coin' },
  { name: 'Aerodrome', symbol: 'AERO', balance: '0.00', value: '$0.00', change: '+0.00%', chain: 'Base', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/base/assets/0x940181a94A35A4569E4529A3CDfB74e38FD98631/logo.png', imageHint: 'aerodrome logo' },

  // Solana Tokens
  { name: 'Solana', symbol: 'SOL', balance: '0.00', value: '$0.00', change: '+0.00%', chain: 'Solana', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/info/logo.png', imageHint: 'solana logo' },
  { name: 'Solana USDC', symbol: 'USDC', balance: '0.00', value: '$0.00', change: '+0.00%', chain: 'Solana', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png', imageHint: 'usdc coin' },
  { name: 'Jupiter', symbol: 'JUP', balance: '0.00', value: '$0.00', change: '+0.00%', chain: 'Solana', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/assets/JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN/logo.png', imageHint: 'jupiter logo' },
  { name: 'Bonk', symbol: 'BONK', balance: '0.00', value: '$0.00', change: '+0.00%', chain: 'Solana', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/assets/DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263/logo.png', imageHint: 'bonk logo' },

  // BSC Tokens
  { name: 'Binance Coin', symbol: 'BNB', balance: '0.00', value: '$0.00', change: '+0.00%', chain: 'BSC', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/binance/info/logo.png', imageHint: 'binance logo' },
  { name: 'BUSD', symbol: 'BUSD', balance: '0.00', value: '$0.00', change: '+0.00%', chain: 'BSC', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x4Fabb145d64652a948d72533023f6E7A623C7C53/logo.png', imageHint: 'busd token' },
  { name: 'PancakeSwap', symbol: 'CAKE', balance: '0.00', value: '$0.00', change: '+0.00%', chain: 'BSC', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/smartchain/assets/0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82/logo.png', imageHint: 'pancakeswap logo' },
  { name: 'BSC USDT', symbol: 'USDT', balance: '0.00', value: '$0.00', change: '+0.00%', chain: 'BSC', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png', imageHint: 'tether logo' },
];

/**
 * Finds all tokens associated with an address based on deterministic simulation.
 * Updated: Now defaults to clean state (zero balances).
 */
export async function scanTokensForAddress(address: string, chain: 'Ethereum' | 'Solana' | 'Base' | 'BSC'): Promise<Token[]> {
  await new Promise(resolve => setTimeout(resolve, 800));
  return TOKEN_LIBRARY.filter(t => t.chain === chain);
}

/**
 * Fetches the base token library for swapping.
 */
export async function getTokenLibrary(chain: 'Ethereum' | 'Solana' | 'Base' | 'BSC'): Promise<Token[]> {
  return TOKEN_LIBRARY.filter(token => token.chain === chain);
}
