'use server';

import { syncValidatorBlocksToNeon } from '@/lib/sync-validator-to-neon';

export async function runValidatorToNeonSync(lookback = 20) {
  return syncValidatorBlocksToNeon(lookback);
}
