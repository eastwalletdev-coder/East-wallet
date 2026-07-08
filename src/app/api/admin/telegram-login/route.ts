// POST /api/admin/telegram-login
// Verifies a Telegram Login Widget payload (from the "Login with Telegram"
// button on /admin/validator-review), checks the user is in FOUNDER_IDS,
// and issues a signed HttpOnly session cookie. Replaces the old pattern of
// typing ADMIN_SECRET into a plaintext password field in the browser.
import { NextRequest, NextResponse } from 'next/server';
import { verifyTelegramLoginWidget, createAdminSessionToken } from '@/lib/telegram-login-widget';
import { ADMIN_SESSION_COOKIE } from '@/lib/admin-auth';

const FOUNDER_IDS = (process.env.FOUNDER_IDS || '').split(',').map((id) => id.trim()).filter(Boolean);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    // Telegram's widget callback sends numeric fields as numbers in JS —
    // normalize everything to strings before hashing/comparing.
    const payload: Record<string, string> = {};
    for (const [k, v] of Object.entries(body || {})) {
      if (v !== undefined && v !== null) payload[k] = String(v);
    }

    if (!verifyTelegramLoginWidget(payload)) {
      return NextResponse.json({ success: false, error: 'INVALID_TELEGRAM_LOGIN' }, { status: 401 });
    }

    const telegramId = payload.id;
    if (!telegramId || !FOUNDER_IDS.includes(telegramId)) {
      return NextResponse.json({ success: false, error: 'NOT_A_FOUNDER' }, { status: 403 });
    }

    const token = createAdminSessionToken(telegramId);

    const res = NextResponse.json({ success: true });
    res.cookies.set(ADMIN_SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 12 * 60 * 60, // 12h — matches SESSION_TTL_MS in telegram-login-widget.ts
    });
    return res;
  } catch (err: any) {
    console.error('[EASTCHAIN] admin telegram-login error:', err);
    return NextResponse.json({ success: false, error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
