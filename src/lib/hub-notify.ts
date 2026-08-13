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
import { postHubJson, hasHub } from '@/lib/hub-urls';

const HUB_SECRET = process.env.RAILWAY_VALIDATOR_SECRET;

export function notifyHubBalanceChanged(address: string | null | undefined, balance: number | string): void {
  if (!hasHub() || !HUB_SECRET || !address) return;
  void postHubJson(
    '/internal/push-balance-update',
    { address: address.toLowerCase(), balance: String(balance) },
    { 'x-railway-secret': HUB_SECRET },
  );
  // best effort — see file doc comment; postHubJson already tries every
  // configured hub (primary region, then secondary) before giving up.
}

// Relays a VERIFIED (signature already checked server-side) sync
// attestation to the hub for broadcast to connected full nodes — so peers
// hold a copy too, not just this server. See full-node-actions.ts and
// identity.ts's full_node_sync_attestations table doc comment for why
// that matters: it means a future height regression can be caught by
// anyone holding both signed attestations, not only by this server.
export function notifyHubSyncAttestation(attestation: {
  walletAddress: string; nodeId: string; height: number; signedAt: number; signature: string;
}): void {
  if (!hasHub() || !HUB_SECRET) return;
  void postHubJson('/internal/push-sync-attestation', attestation, { 'x-railway-secret': HUB_SECRET });
  // best effort — the attestation is already durably stored in Postgres
  // regardless; this only affects how quickly peers see it.
}
