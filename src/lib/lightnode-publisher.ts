/**
 * EASTCHAIN → Railway Hub publisher.
 *
 * Vercel functions are stateless/serverless, so instead of holding a
 * persistent WebSocket connection open (awkward across cold starts),
 * we just POST the sealed block header to Railway's HTTP endpoint.
 * Railway then relays it over WS to every connected Light Node.
 *
 * Best-effort: if Railway is unreachable or env vars aren't set, this
 * silently no-ops so a Light Node outage never blocks a real claim/tx.
 */

interface PublishHeader {
  height: number;
  hash: string;
  previousHash: string;
  merkleRoot: string;
  validator: string | null;
  timestamp: number;
  epoch: number;
  signature?: string | null; // secp256k1/EIP-191 sig from chain-signing.ts — null if CHAIN_SIGNING_PRIVATE_KEY unset
}

export async function publishBlockToRailway(header: PublishHeader): Promise<void> {
  const url = process.env.RAILWAY_PUBLISH_URL;
  const secret = process.env.RAILWAY_VALIDATOR_SECRET;
  if (!url || !secret) return; // not configured — no-op

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-railway-secret": secret },
      body: JSON.stringify({ header }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch (err) {
    console.error("[EASTCHAIN] Railway publish failed (non-fatal):", err);
  }
}
