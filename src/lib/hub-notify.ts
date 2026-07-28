// Fire-and-forget push to the Railway hub whenever a balance changes, so
// opted-in "Full Lightnode" clients' local replicas stay current (see
// hub/src/server.ts's broadcastToFullNodes and this project's
// lightnode/client.ts balanceReplica). Deliberately non-blocking and
// swallow-all-errors: nothing about balance correctness depends on this —
// Postgres is written first and is the only source of truth. If the hub
// is down or this call fails, the only consequence is a full-lightnode's
// replica going stale until the next successful push for that address,
// which /api/rpc's eth_getBalance already tolerates (falls back to
// Postgres on any hub-side miss).
const HUB_URL = process.env.RAILWAY_HUB_URL;
const HUB_SECRET = process.env.RAILWAY_VALIDATOR_SECRET;

export function notifyHubBalanceChanged(address: string | null | undefined, balance: number | string): void {
  if (!HUB_URL || !HUB_SECRET || !address) return;
  fetch(`${HUB_URL}/internal/push-balance-update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-railway-secret': HUB_SECRET },
    body: JSON.stringify({ address: address.toLowerCase(), balance: String(balance) }),
  }).catch(() => {
    // best effort — see file doc comment
  });
}
