// Paste into createSelfCustodyWallet after INSERT, before referral block:
//
//   const bird = await grantEarlyBirdBonusIfEligible(client, telegramId);
//   if (bird.granted > 0) {
//     console.log(`[EASTCHAIN] Early bird +${bird.granted} EAST → ${telegramId}`);
//   }
//
// import { grantEarlyBirdBonusIfEligible } from '@/lib/early-bird';
