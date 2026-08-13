/**
 * Resolves the Railway hub base URL(s), in failover order.
 *
 * Supports two hubs in different regions (e.g. Singapore primary,
 * US secondary) so a region-wide Railway outage doesn't take down chain
 * reads/writes — callers try RAILWAY_HUB_URL first, then RAILWAY_HUB_URL_2.
 *
 * EAST_HUB_URL is kept as a legacy single-hub fallback name — it only
 * applies when RAILWAY_HUB_URL is unset, same as before this file existed.
 *
 * Env vars (Vercel):
 *   RAILWAY_HUB_URL    — primary hub, e.g. Singapore (https://sg-hub.up.railway.app)
 *   RAILWAY_HUB_URL_2  — secondary hub, e.g. US (https://us-hub.up.railway.app)
 *   EAST_HUB_URL       — legacy fallback name, only used if RAILWAY_HUB_URL is unset
 */
export function hubBases(): string[] {
  const primary = process.env.RAILWAY_HUB_URL || process.env.EAST_HUB_URL || '';
  const secondary = process.env.RAILWAY_HUB_URL_2 || '';
  return [primary, secondary]
    .map((u) => u.trim().replace(/\/$/, ''))
    .filter((u): u is string => u.length > 0);
}

/** True if at least one hub base URL is configured. */
export function hasHub(): boolean {
  return hubBases().length > 0;
}

/**
 * GET JSON from the first hub that returns an ok response, trying each
 * configured hub base in order (primary, then secondary) before giving up.
 * `path` is appended as-is to each hub base — include the leading slash.
 */
export async function fetchHubJson(path: string, timeoutMs = 8_000): Promise<any | null> {
  for (const base of hubBases()) {
    try {
      const res = await fetch(`${base}${path}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) continue; // try next hub
      return await res.json();
    } catch {
      // network error / timeout on this hub — fall through to next
    }
  }
  return null;
}

/**
 * POST JSON to the first hub that accepts it (2xx), trying each configured
 * hub base in order. Returns the parsed response body, or null if every
 * configured hub failed.
 */
export async function postHubJson(path: string, body: unknown, extraHeaders?: Record<string, string>, timeoutMs = 8_000): Promise<any | null> {
  for (const base of hubBases()) {
    try {
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(extraHeaders || {}) },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) continue; // try next hub
      return await res.json().catch(() => ({}));
    } catch {
      // network error / timeout on this hub — fall through to next
    }
  }
  return null;
}
