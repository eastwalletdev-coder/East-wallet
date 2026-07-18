import { NextResponse } from 'next/server';
import { identityPool } from '@/lib/db/identity';

export async function GET() {
  try {
    const client = await identityPool.connect();
    try {
      const res = await client.query(`
        SELECT 
          label, total_amount, unlocked_amount, monthly_release,
          start_date, next_unlock, months_released, total_months, cliff_months, is_completed
        FROM identity.vesting
        ORDER BY created_at DESC
        LIMIT 1
      `);
      return NextResponse.json({ vesting: res.rows[0] ?? null });
    } finally {
      client.release();
    }
  } catch (err) {
    return NextResponse.json({ vesting: null }, { status: 500 });
  }
}
