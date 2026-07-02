import { NextRequest, NextResponse } from 'next/server';
import { checkClaimCooldown } from '@/lib/db/redis';

export async function GET(req: NextRequest) {
  const tgId = req.nextUrl.searchParams.get('tgId');
  if (!tgId) return NextResponse.json({ allowed: true, remainingSeconds: 0 });
  try {
    const result = await checkClaimCooldown(tgId);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ allowed: true, remainingSeconds: 0 });
  }
}
