/**
 * EASTCHAIN — R2 block archive (write side)
 * ─────────────────────────────────────────────────────────────────────
 * Solves the gap Railway's WS hub has by design: it only keeps a small
 * in-memory ring buffer of recent block headers (last ~20) for backfill,
 * since it's a lightweight relay, not a database. A Light Node that's
 * been offline longer than that has no way to fill the gap today — see
 * lightnode/client.ts's verifyHeader() comment about accepting a "jump"
 * instead of getting stuck.
 *
 * This archives EVERY sealed block header permanently to Cloudflare R2,
 * one small immutable JSON object per height (key: blocks/{height}.json).
 * One-object-per-block (rather than growing chunk files) means every
 * write is a single idempotent PUT — no read-modify-write race with
 * concurrent Vercel invocations, and R2 has no egress fee so a Light
 * Node fetching hundreds of small cached-forever objects directly from
 * Cloudflare's CDN costs nothing extra and touches Vercel not at all.
 *
 * Bucket layout:
 *   blocks/{height}.json  → BlockHeader JSON, written once, never changes
 *   latest.json           → { height, hash, updatedAt } — cheap pointer
 *                            so a Light Node can tell how big its gap is
 *                            before deciding whether to consult the
 *                            archive at all. Benign last-write-wins race
 *                            here is fine — it's just a hint, not a
 *                            source of truth (ledger.blocks in Postgres
 *                            remains canonical; Railway's own "welcome"
 *                            message is the authoritative live tip).
 *
 * Best-effort, same pattern as lightnode-publisher.ts: if R2 env vars
 * aren't set or the request fails/times out, this silently no-ops so an
 * archive outage never blocks a real claim/tx from sealing.
 */
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

export interface ArchivedBlockHeader {
  height: number;
  hash: string;
  previousHash: string;
  merkleRoot: string;
  validator: string | null;
  timestamp: number;
  epoch: number;
  signature: string | null;
}

let cachedClient: S3Client | null = null;

function getClient(): S3Client | null {
  const accountId = process.env.CLOUDFLARE_R2_ACCOUNT_ID;
  const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) return null;

  if (!cachedClient) {
    cachedClient = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  return cachedClient;
}

async function putJson(bucket: string, key: string, body: unknown, timeoutMs = 4000): Promise<void> {
  const client = getClient();
  if (!client) return; // not configured — no-op

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: JSON.stringify(body),
        ContentType: 'application/json',
        // Content is immutable once written (except latest.json) — let
        // Cloudflare's CDN cache it essentially forever.
        CacheControl: key === 'latest.json' ? 'public, max-age=5' : 'public, max-age=31536000, immutable',
      }),
      { abortSignal: controller.signal }
    );
  } catch (err) {
    console.error(`[EASTCHAIN] R2 archive write failed for ${key} (non-fatal):`, err);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Called right after every sealed block, alongside publishBlockToRailway().
 * Writes the immutable per-height object AND refreshes the latest pointer.
 * Fire-and-forget from the caller's perspective — never throws.
 */
export async function archiveBlockToR2(header: ArchivedBlockHeader): Promise<void> {
  const bucket = process.env.CLOUDFLARE_R2_BUCKET;
  if (!bucket) return; // not configured — no-op

  await Promise.all([
    putJson(bucket, `blocks/${header.height}.json`, header),
    putJson(bucket, 'latest.json', {
      height: header.height,
      hash: header.hash,
      updatedAt: Date.now(),
    }),
  ]);
}
