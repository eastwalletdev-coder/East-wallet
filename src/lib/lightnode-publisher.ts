/**
 * EASTCHAIN → Railway Hub publisher.
 *
 * Vercel functions are stateless/serverless, so instead of holding a
 * persistent WebSocket connection open (awkward across cold starts),
 * we just POST the sealed block header to Railway's HTTP endpoint.
 * Railway then relays it over WS to every connected Light Node.
 *
 * Supports two hubs in different regions for failover (e.g. Singapore
 * primary, US secondary) — tries RAILWAY_PUBLISH_URL first, and only
 * falls through to RAILWAY_PUBLISH_URL_2 if the first one is unreachable
 * or rejects the publish. Both env vars must be the FULL endpoint URL
 * (including /internal/publish-block), not just the hub's base domain.
 *
 * Best-effort: if every configured hub is unreachable or no env vars are
 * set, this silently no-ops so a Light Node outage never blocks a real
 * claim/tx.
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
  const secret = process.env.RAILWAY_VALIDATOR_SECRET;
  // Primary region hub first (e.g. Singapore), then secondary (e.g. US).
  // Each must be the FULL endpoint URL including /internal/publish-block —
  // this function does not append any path.
  const urls = [process.env.RAILWAY_PUBLISH_URL, process.env.RAILWAY_PUBLISH_URL_2]
    .filter((u): u is string => Boolean(u && u.trim()));
  if (urls.length === 0 || !secret) return; // not configured — no-op

  for (const url of urls) {
    try {
      const controller = new AbortController();
      // Railway free-tier services sleep when idle and can take several
      // seconds to cold-start on the next request — 3s was tripping the
      // AbortController on a healthy-but-cold hub, logging a scary
      // "Railway publish failed" error for a publish that would've
      // succeeded a couple seconds later. 8s gives it room without
      // meaningfully delaying the (already fire-and-forget, non-awaited)
      // caller in block-engine.ts.
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-railway-secret": secret },
        body: JSON.stringify({ header }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (res.ok) return; // published successfully — no need to try the next hub
      console.error(`[EASTCHAIN] Railway publish rejected by ${url} (status ${res.status}) — trying next hub if any`);
    } catch (err) {
      console.error(`[EASTCHAIN] Railway publish failed for ${url} (non-fatal) — trying next hub if any:`, err);
    }
  }
}
