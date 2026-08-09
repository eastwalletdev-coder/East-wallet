/**
 * First N users receive a free EAST balance on identity.users (Neon mining ledger).
 * On-chain validator balance is separate — this is the app ledger bonus.
 */
export const EARLY_BIRD_LIMIT = Number(process.env.EARLY_BIRD_USER_LIMIT || 10_000);
export const EARLY_BIRD_AMOUNT = Number(process.env.EARLY_BIRD_BONUS_EAST || 200);

/**
 * Call inside an open transaction after confirming the user row is brand-new.
 * Returns the bonus granted (0 if slots exhausted).
 */
export async function grantEarlyBirdBonusIfEligible(
  client: { query: (q: string, params?: any[]) => Promise<any> },
  telegramId: string,
): Promise<{ granted: number; remainingSlots: number }> {
  // Count existing users excluding this id (row may already be inserted with balance 0)
  const countRes = await client.query(
    `SELECT COUNT(*)::int AS n FROM identity.users WHERE telegram_id <> $1`,
    [telegramId],
  );
  const others = Number(countRes.rows[0]?.n || 0);
  if (others >= EARLY_BIRD_LIMIT) {
    return { granted: 0, remainingSlots: 0 };
  }

  // Idempotent: only grant if not already marked / still zero balance path
  const u = await client.query(
    `SELECT balance, COALESCE(early_bird_bonus, false) AS early_bird_bonus
     FROM identity.users WHERE telegram_id = $1 FOR UPDATE`,
    [telegramId],
  );
  if (!u.rows.length) return { granted: 0, remainingSlots: EARLY_BIRD_LIMIT - others };
  if (u.rows[0].early_bird_bonus === true) {
    return { granted: 0, remainingSlots: Math.max(0, EARLY_BIRD_LIMIT - others - 1) };
  }

  await client.query(
    `UPDATE identity.users
     SET balance = balance + $1,
         early_bird_bonus = true,
         updated_at = NOW()
     WHERE telegram_id = $2`,
    [EARLY_BIRD_AMOUNT, telegramId],
  );

  return {
    granted: EARLY_BIRD_AMOUNT,
    remainingSlots: Math.max(0, EARLY_BIRD_LIMIT - others - 1),
  };
}
