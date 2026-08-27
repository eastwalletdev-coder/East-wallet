import { createHash } from 'crypto';

export interface BlockData {
  index: number;
  timestamp: number;
  prevHash: string;
  minerId: string;
  reward: number;
}

export interface StakeData {
  tgId: string;
  amount: number;
  timestamp: number;
  lockedUntil: number;
}

export function calculateHash(data: BlockData): string {
  const content = `${data.index}${data.timestamp}${data.prevHash}${data.minerId}${data.reward}`;
  return '0x' + createHash('sha256').update(content).digest('hex');
}

export function calculateStakeHash(data: StakeData): string {
  const content = `STAKE_${data.tgId}_${data.amount}_${data.timestamp}_${data.lockedUntil}`;
  return '0x' + createHash('sha256').update(content).digest('hex');
}

export function generateWalletFromTelegramId(telegramId: string): string {
  const hash = createHash('sha256')
    .update(`EASTCHAIN_${telegramId}_${process.env.WALLET_ADDRESS_SALT || 'east_salt'}`)
    .digest('hex');
  return '0x' + hash.substring(0, 40);
}

// TOKENOMICS CONSTANTS
export const MAX_SUPPLY           = 1_000_000_000;
export const MINING_REWARDS_CAP   =   650_000_000;
export const LIQUIDITY_POOL_CAP   =   100_000_000;
export const TREASURY_CAP         =   100_000_000;
export const FOUNDER_CAP          =    50_000_000;
export const MARKETING_CAP        =    50_000_000;
export const TEAM_CAP             =    50_000_000;
export const MINING_REWARD        =     5;

// REFERRAL CONSTANTS
export const REFERRAL_BONUS       =    1;
export const REFERRAL_CAP         =    5_000;
export const REFERRAL_CLAIM_TRIGGER =  4;
