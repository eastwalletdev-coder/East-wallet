export interface EastpassTier {
  level: number;
  name: string;
  requirement: number;
  boost: number;
  apy: number;
}

export const EASTPASS_TIERS: EastpassTier[] = [
  { level: 0, name: "Novice",  requirement: 0,    boost: 1,  apy: 0    },
  { level: 1, name: "Vision",      requirement: 500,  boost: 2,  apy: 0.03 },
  { level: 2, name: "Broadcaster", requirement: 1500, boost: 4,  apy: 0.05 },
  { level: 3, name: "Guardian",    requirement: 3000, boost: 7,  apy: 0.08 },
  { level: 4, name: "Leader",      requirement: 5000, boost: 10, apy: 0.12 },
];

export function getTierFromStaked(amount: number): EastpassTier {
  return [...EASTPASS_TIERS].reverse().find(t => amount >= t.requirement) || EASTPASS_TIERS[0];
}

// Re-export for backward compat — wallet generation moved to blockchain.ts (server-side only)
export { generateWalletFromTelegramId as generateWalletFromTelegram } from './blockchain';
