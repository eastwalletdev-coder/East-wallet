/**
 * EAST ID Generator
 * Format: EAST-XXXX-XXXX-XXXX (readable, deterministic from wallet address)
 * Example: EAST-7429-XKMD-9F2A
 */
import { createHash } from 'crypto';

const CONSONANTS = 'BCDFGHJKLMNPQRSTVWXYZ';
const HEX = '0123456789ABCDEF';

export function generateEastId(walletAddress: string): string {
  const hash = createHash('sha256').update(walletAddress.toLowerCase()).digest('hex');

  // Segment 1: 4 digits
  const num = parseInt(hash.substring(0, 4), 16) % 10000;
  const seg1 = num.toString().padStart(4, '0');

  // Segment 2: 4 consonants (more readable, no vowels to avoid words)
  let seg2 = '';
  for (let i = 0; i < 4; i++) {
    seg2 += CONSONANTS[parseInt(hash[4 + i * 2], 16) % CONSONANTS.length];
  }

  // Segment 3: 4 hex chars
  const seg3 = hash.substring(12, 16).toUpperCase();

  return `EAST-${seg1}-${seg2}-${seg3}`;
}

export function getPassStatusLabel(tier: number): string {
  const labels: Record<number, string> = {
    0: 'INACTIVE',
    1: 'ACTIVE · BASIC',
    2: 'ACTIVE · PRO',
    3: 'ACTIVE · ELITE',
    4: 'ACTIVE · WHALE',
  };
  return labels[tier] || 'INACTIVE';
}

export function isPassActive(tier: number): boolean {
  return tier > 0;
}
