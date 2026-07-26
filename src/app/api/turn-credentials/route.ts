// GET /api/turn-credentials
//
// Uses Metered's secretKey flow (account-wide key, Dashboard → Developers)
// instead of a single reusable per-credential apiKey — this mints a BRAND
// NEW, short-lived TURN credential on every call instead of reusing the
// same one indefinitely, so a leaked credential ages out fast instead of
// working forever. Two calls to Metered per request:
//   1. POST .../turn/credential?secretKey=... — mints a fresh credential,
//      scoped to expire in TURN_CREDENTIAL_TTL_SECONDS, returns a
//      credential-scoped apiKey for step 2.
//   2. GET .../turn/credentials?apiKey=<from step 1> — resolves that
//      credential into the actual RTCIceServer[] array (urls/username/
//      credential) the browser needs.
//
// secretKey itself never leaves this route — same reasoning as before:
// nothing TURN-related belongs in the client bundle if it doesn't have to.
// It's MORE sensitive than the old per-credential apiKey (account-wide,
// not credential-scoped), which is exactly why it's worth minting
// short-lived credentials with it rather than shipping it anywhere close
// to the client, even indirectly.
//
// If TURN isn't configured at all, returns { configured: false } and the
// client falls back to STUN-only exactly like before this endpoint
// existed — see client.ts's fetchIceServers().
import { NextRequest, NextResponse } from 'next/server';
import { checkTurnCredentialsRateLimit } from '@/lib/db/redis';

const TURN_CREDENTIAL_TTL_SECONDS = 3600; // 1 hour — long enough for a session + reconnects, short enough a leaked one ages out fast

export async function GET(req: NextRequest) {
  try {
    const domain = process.env.METERED_APP_DOMAIN;   // e.g. "yourappname" (NOT the full https://... URL)
    const secretKey = process.env.METERED_SECRET_KEY; // Dashboard → Developers → Secret Key

    if (!domain || !secretKey) {
      // Not an error — most deployments won't have a TURN server
      // configured. The client treats this exactly like "TURN not
      // configured" and keeps working STUN-only.
      return NextResponse.json({ configured: false });
    }

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
    const rl = await checkTurnCredentialsRateLimit(ip);
    if (!rl.allowed) {
      return NextResponse.json(
        { configured: false, error: 'RATE_LIMITED' },
        { status: 429, headers: { 'Retry-After': String(rl.remainingSeconds ?? 60) } }
      );
    }

    // Step 1 — mint a fresh, short-lived credential.
    const mintRes = await fetch(
      `https://${domain}.metered.live/api/v1/turn/credential?secretKey=${encodeURIComponent(secretKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expiryInSeconds: TURN_CREDENTIAL_TTL_SECONDS,
          label: 'eastchain-lightnode',
        }),
      }
    );
    if (!mintRes.ok) {
      console.error('[EASTCHAIN] Metered credential mint failed', mintRes.status, await mintRes.text().catch(() => ''));
      return NextResponse.json({ configured: false });
    }
    const minted = await mintRes.json();
    if (!minted?.apiKey) {
      console.error('[EASTCHAIN] Metered mint response missing apiKey:', minted);
      return NextResponse.json({ configured: false });
    }

    // Step 2 — resolve that credential into an actual ICE servers array.
    const iceRes = await fetch(
      `https://${domain}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(minted.apiKey)}`
    );
    if (!iceRes.ok) {
      console.error('[EASTCHAIN] Metered ICE servers fetch failed', iceRes.status, await iceRes.text().catch(() => ''));
      return NextResponse.json({ configured: false });
    }
    const iceServers = await iceRes.json();

    return NextResponse.json({
      configured: true,
      iceServers,
      ttlSeconds: TURN_CREDENTIAL_TTL_SECONDS,
    });
  } catch (err: any) {
    console.error('[EASTCHAIN] turn-credentials error:', err);
    // Fail open toward "no TURN" rather than failing the whole WebRTC
    // connection attempt — losing the TURN option degrades to STUN-only,
    // never worse than that.
    return NextResponse.json({ configured: false });
  }
}
