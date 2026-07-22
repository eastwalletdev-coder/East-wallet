"use client"

import { verifyMessage } from "ethers";
import type { BlockHeader, InboundMessage } from "./protocol";
import { EAST_CHAIN_ID } from "@/lib/contracts/registry";
import { PeerMesh } from "./webrtc-peer";
import { putBlock } from "./block-store";

const STORAGE_KEY = "east_lightnode_state_v1";
const HEARTBEAT_MS = 20_000;
const RELAY_STATS_INTERVAL_MS = 30_000; // how often we self-report score inputs to Railway

// Reconnect backoff — matters more now that Railway's hub can sleep after
// 10 min with zero connections (Serverless mode). The FIRST connection
// attempt against a sleeping hub commonly fails with a 502 while it cold
// boots; without a retry, the node would just sit disconnected forever.
// Backoff doubles each failure up to the cap so a genuinely-down hub
// doesn't get hammered, but a cold-starting one (usually ready in a few
// seconds) gets picked up quickly.
const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;
// At thousands of concurrent light nodes, a single Railway restart/redeploy
// drops everyone at once — without jitter, they'd all retry at the exact
// same instant every round (2s, 4s, 8s...), hammering the hub right as
// it's warming back up. +/-30% randomization spreads that into a burst
// instead of a single spike.
const RECONNECT_JITTER_RATIO = 0.3;
function withJitter(delayMs: number): number {
  const jitter = delayMs * RECONNECT_JITTER_RATIO;
  return Math.round(delayMs - jitter + Math.random() * jitter * 2);
}
const MIN_VERIFIED_HEADERS = 2;      // lowered from 5 — empty blocks only seal
                                      // every 30min, so requiring 5 *new* headers
                                      // per session made the header gate far
                                      // stricter than the 120s participation gate.
                                      // 2 is reachable via initial backfill alone.
const MIN_PARTICIPATION_SECONDS = 120; // 2 minutes
const STEP_DELAY_MS = 600;           // pacing so the sync steps are visibly animated,
                                      // not an instant jump-cut to "done"

// How big a gap has to be before we stop trusting Railway's plain
// sync_request and proactively go get it from a peer (an external
// validator's full ledger) or the archive instead. This must stay SMALL —
// it's the trigger for actually using external validators at all. A gap
// of, say, 859 blocks is exactly the case a Termux/VPS validator's
// full-node-sync.js is built to serve; if this threshold is too high, the
// client just never asks the validator in the first place, no matter how
// many are online.
const PEER_AND_ARCHIVE_TRIGGER_GAP = 20;

// Raw capacity of Railway's in-memory ring buffer (see BACKFILL_SIZE in
// railway-server's server.ts — keep these two in sync). Only used to size
// the small "tail" left for Railway's own backfill after archive-filling
// the rest in catchUpFromArchive() — NOT used to decide whether to trust
// Railway in the first place (that's PEER_AND_ARCHIVE_TRIGGER_GAP above).
// The buffer resets to empty on every Railway restart/redeploy (it only
// refills from live block:new broadcasts going forward, never
// retroactively) — that's what SYNC_REQUEST_WATCHDOG_MS below guards
// against even for the small tail.
const RAILWAY_BACKFILL_LIMIT = 1000;
const ARCHIVE_RANGE_CHUNK = 500; // matches MAX_RANGE server-side cap in /api/archive/blocks-range — one request covers this many heights instead of one request per height
const FULL_SYNC_PEER_TIMEOUT_MS = 15_000; // give a peer this long before falling back to the archive
const SYNC_REQUEST_WATCHDOG_MS = 10_000; // if a plain sync_request hasn't closed the gap by then, Railway's buffer likely didn't have it — fall back to the archive instead of hanging forever
const LIGHTNODE_PEER_GOSSIP_TIMEOUT_MS = 5_000; // how long to wait for other lightnodes (WebRTC mesh) to answer a gap request before moving on to a validator/archive

// Blocks at or above this height MUST carry a valid secp256k1 (EVM-style
// EIP-191) signature — no more "accepted but not cryptographically
// verified" fallback. Blocks below it predate the chain-signing feature
// (see chain-signing.ts) and are the only ones still allowed through
// unsigned. Set via env once the height at which signing went live is
// known; if unset, ALL blocks require a signature (safe default —
// nothing is silently trusted).
const SIGNING_ENFORCED_FROM_HEIGHT = Number(process.env.NEXT_PUBLIC_SIGNING_ENFORCED_FROM_HEIGHT ?? 0);

export type SyncPhase = "idle" | "connecting" | "downloading" | "validating" | "live";

export interface LightNodeState {
  nodeId: string;
  connectionStatus: "connecting" | "connected" | "disconnected";
  syncPhase: SyncPhase;
  syncProgress: { current: number; total: number };
  currentHeight: number;
  verifiedHeaderCount: number;
  participationSeconds: number;
  lastHeartbeat: number | null;
  lastClaimEpoch: string | null;
  latencyMs: number | null;
  eligible: boolean;
  log: { time: number; message: string; level?: "info" | "warn" | "error" }[];
  // WebRTC peer mesh — Railway is still the only introduction point; this
  // is just which peers we've since connected to directly. See webrtc-peer.ts.
  isRelay: boolean;               // did Railway promote US into the top-N this round?
  relayRoster: string[];          // last known top-N relay nodeIds, from Railway
  connectedPeerIds: string[];     // peers we currently have an OPEN DataChannel with
}

function loadState(): LightNodeState {
  if (typeof window === "undefined") return freshState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshState();
    const parsed = JSON.parse(raw);
    return {
      ...freshState(),
      ...parsed,
      connectionStatus: "disconnected", // never trust a persisted "connected"
      syncPhase: "idle",
      syncProgress: { current: 0, total: 0 },
      isRelay: false,
      connectedPeerIds: [],
    };
  } catch {
    return freshState();
  }
}

function freshState(): LightNodeState {
  return {
    nodeId: (typeof crypto !== "undefined" && crypto.randomUUID)
      ? crypto.randomUUID() : `node-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    connectionStatus: "disconnected",
    syncPhase: "idle",
    syncProgress: { current: 0, total: 0 },
    currentHeight: -1,
    verifiedHeaderCount: 0,
    participationSeconds: 0,
    lastHeartbeat: null,
    lastClaimEpoch: null,
    latencyMs: null,
    eligible: false,
    log: [],
    isRelay: false,
    relayRoster: [],
    connectedPeerIds: [],
  };
}

function persist(state: LightNodeState) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}

// ── Header verification (mirrors railway-server's intent, runs client-side
//    since Light Nodes — not Railway — are the ones that actually verify) ──
function verifyHeader(header: BlockHeader, prevHeight: number, prevHash: string | null): { valid: boolean; reason?: string } {
  if (!header.hash || header.hash.length < 16) return { valid: false, reason: "Invalid block hash" };
  if (prevHeight >= 0) {
    // Reject anything at or behind what we've already seen (stale/duplicate).
    if (header.height <= prevHeight) return { valid: false, reason: "Stale or duplicate block height" };
    // Only enforce hash continuity for the immediate next block. If there's
    // a gap (e.g. the device was offline and the chain moved on), we can't
    // verify the intermediate links — that's expected for a Light Node and
    // isn't evidence of tampering, so we accept the jump instead of getting
    // stuck forever waiting for blocks that already scrolled out of the hub's history.
    if (header.height === prevHeight + 1 && prevHash && header.previousHash !== prevHash) {
      return { valid: false, reason: "Previous hash mismatch" };
    }
  }

  // Signature check: proves this header actually came from Vercel's
  // sealBlock() — not a leaked R2 write credential or a compromised
  // Railway relay serving a self-consistent but fake chain.
  //
  // secp256k1 / EVM-style (EIP-191 personal_sign): we don't compare
  // against a raw public key, we recover the signer ADDRESS from the
  // signature and compare it to the trusted address — same pattern as
  // evm-signature.ts's verifyEvmOwnership on the server side.
  //
  // MANDATORY from SIGNING_ENFORCED_FROM_HEIGHT onward — a block in that
  // range with no signature, or a signature that doesn't verify, is
  // rejected outright. Only blocks BELOW that height (pre-signing history,
  // whitelisted by height, not by trust) may still pass unsigned.
  const chainSigningAddress = process.env.NEXT_PUBLIC_CHAIN_SIGNING_ADDRESS;
  const isPreSigningHistory = header.height < SIGNING_ENFORCED_FROM_HEIGHT;

  if (!chainSigningAddress) {
    // No trusted address configured at all — signing can't be enforced
    // client-side. Fail closed rather than silently accepting every block
    // as "verified".
    return { valid: false, reason: "Chain signing not configured — cannot verify block" };
  }

  if (!header.signature) {
    if (isPreSigningHistory) {
      return { valid: true, reason: `Unsigned — accepted as pre-signing history (height < ${SIGNING_ENFORCED_FROM_HEIGHT})` };
    }
    return { valid: false, reason: "Missing signature — rejected (signing is mandatory at this height)" };
  }

  if (!verifyChainSignature(chainSigningAddress, header.height, header.hash, header.signature)) {
    return { valid: false, reason: "Invalid chain signature — possible tampering" };
  }

  return { valid: true, reason: "Signature verified" };
}

function verifyChainSignature(trustedAddress: string, height: number, blockHash: string, signatureHex: string): boolean {
  try {
    const message = `EASTCHAIN_BLOCK|${height}|${blockHash}`;
    const recovered = verifyMessage(message, signatureHex);
    return recovered.toLowerCase() === trustedAddress.toLowerCase();
  } catch {
    return false;
  }
}

type Listener = (state: LightNodeState) => void;

export class LightNodeClient {
  private ws: WebSocket | null = null;
  private state: LightNodeState;
  private listeners = new Set<Listener>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private participationTimer: ReturnType<typeof setInterval> | null = null;
  private relayStatsTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelayMs = RECONNECT_BASE_MS;
  private manualDisconnect = false;
  private lastHash: string | null = null;
  private pingSentAt = 0;
  private url: string;
  private peerMesh: PeerMesh;
  private fullSyncProviders: string[] = [];
  private pendingFullSyncRequest: { fromNodeId: string; resolve: (ok: boolean) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  private syncRequestWatchdog: ReturnType<typeof setTimeout> | null = null;

  constructor(url: string) {
    this.url = url;
    this.state = loadState();
    this.peerMesh = new PeerMesh({
      sendSignal: (msg) => this.ws?.send(JSON.stringify(msg)),
      onPeerHeader: (peerNodeId, header) => {
        // Same trust boundary as a Railway-sourced header — verifyHeader()
        // inside applyHeader() doesn't know or care which transport it came
        // from. A peer can only waste bandwidth by sending junk, never get
        // an unverified header accepted.
        this.applyHeader(header, true);
      },
      onPeerConnected: (peerNodeId) => {
        this.log(`Peer mesh: connected to ${peerNodeId.slice(0, 8)}…`);
        this.set({ connectedPeerIds: this.peerMesh.connectedPeerIds });
      },
      onPeerDisconnected: (peerNodeId) => {
        this.log(`Peer mesh: disconnected from ${peerNodeId.slice(0, 8)}…`);
        this.set({ connectedPeerIds: this.peerMesh.connectedPeerIds });
      },
    });
  }

  getState(): LightNodeState { return this.state; }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<LightNodeState>) {
    this.state = { ...this.state, ...patch };
    persist(this.state);
    this.listeners.forEach((fn) => fn(this.state));
  }

  private log(message: string, level: "info" | "warn" | "error" = "info") {
    const entry = { time: Date.now(), message, level };
    // 200 instead of 50 — signature rejections/backfill detail add more
    // entries per session than before, and this is the only record of
    // what a given node actually verified.
    const log = [...this.state.log, entry].slice(-200);
    this.set({ log });
    // Mirror to devtools console too, so a rejected/invalid block is
    // visible even if the panel isn't open or history has scrolled past it.
    const prefix = `[LightNode:${this.state.nodeId ?? "?"}]`;
    if (level === "error") console.error(prefix, message);
    else if (level === "warn") console.warn(prefix, message);
    else console.log(prefix, message);
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.manualDisconnect = false;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.set({ connectionStatus: "connecting" });
    this.log("Connecting…");

    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.set({ connectionStatus: "connected" });
      this.log("Connected");
      this.reconnectDelayMs = RECONNECT_BASE_MS; // hub is up — forget any backoff from earlier failed attempts
      ws.send(JSON.stringify({ type: "hello", role: "light-node", nodeId: this.state.nodeId, chainId: EAST_CHAIN_ID }));
      this.startHeartbeat();
      this.startParticipationClock();
      this.startRelayStats();
    };

    ws.onmessage = (ev) => {
      let msg: InboundMessage;
      try { msg = JSON.parse(ev.data); } catch { return; }

      switch (msg.type) {
        case "welcome":
          this.set({ syncPhase: "downloading" });
          this.log("Synchronization Started");
          // Railway's own latestHeight is NOT trustworthy alone — it's only
          // whatever block:new broadcasts Railway itself has seen since ITS
          // last restart, not the real chain height. If Railway just
          // restarted (or nothing's been sealed since), it reports -1 even
          // when the real chain is at block #800+. Confirm with Vercel's
          // authoritative /api/chain-height before deciding whether the gap
          // needs the archive — otherwise a stale/-1 Railway tip makes a
          // real 200-block gap look like "nothing to catch up", and this
          // node quietly stays behind forever. Same fix as full-node-sync.js.
          this.resolveNetworkTip(msg.latestHeight).then(async (latestHeight) => {
            if (latestHeight >= 0) {
              this.log(`Network tip is block #${latestHeight}`);
            }
            const gap = latestHeight - this.state.currentHeight;
            const archiveUrl = process.env.NEXT_PUBLIC_ARCHIVE_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;

            if (gap > PEER_AND_ARCHIVE_TRIGGER_GAP + 1) {
              // Step 1 of 3: other lightnodes first (WebRTC mesh, see
              // webrtc-peer.ts's requestRange + block-store.ts). Spreads
              // catch-up load across whoever's already connected and
              // happens to have this range in their own last-1000-block
              // IndexedDB cache — costs Railway/Vercel nothing at all.
              // Only the contiguous run from currentHeight+1 is applied;
              // the loop stops at the first hole so whatever's still
              // missing correctly falls through to the next step below.
              const peerBlocks = await this.peerMesh.requestRange(
                this.state.currentHeight + 1, latestHeight, LIGHTNODE_PEER_GOSSIP_TIMEOUT_MS
              );
              if (peerBlocks.length > 0) {
                const byHeight = new Map<number, any>(peerBlocks.map((b: any) => [b.height, b]));
                let appliedFromPeers = 0;
                for (let h = this.state.currentHeight + 1; h <= latestHeight; h++) {
                  const header = byHeight.get(h);
                  if (!header) break;
                  this.applyHeader(header, true);
                  appliedFromPeers++;
                }
                if (appliedFromPeers > 0) {
                  this.log(`Caught up ${appliedFromPeers} block(s) from lightnode peers via WebRTC`);
                }
              }

              // Step 2 of 3: a validator's full node (Termux/VPS,
              // full-node-sync.js) over Vercel — spreads whatever's still
              // missing across the network instead of every node with a
              // gap hitting the same serverless endpoint. Best-effort:
              // currentHeight advances as far as the peer's contiguous,
              // verified response reaches, then whatever's still missing
              // falls through below.
              await this.tryPeerCatchUp(this.state.currentHeight + 1, latestHeight);
            }

            // Step 3 of 3: the archive (or Railway's own small ring
            // buffer for whatever's left) — same as before.
            const remainingGap = latestHeight - this.state.currentHeight;
            if (remainingGap > PEER_AND_ARCHIVE_TRIGGER_GAP + 1 && archiveUrl) {
              this.catchUpFromArchive(archiveUrl, latestHeight);
            } else if (remainingGap > 0) {
              // Small enough for Railway's own ring-buffer backfill, or no
              // peer/archive was available — this is the same request the
              // hub already understands.
              this.ws?.send(JSON.stringify({
                type: "sync_request", nodeId: this.state.nodeId, fromHeight: this.state.currentHeight + 1,
              }));

              // Safety net: Railway's buffer is only whatever it's seen
              // live since its own last restart — it can come back empty
              // even for a gap "small enough" per RAILWAY_BACKFILL_LIMIT.
              // If the gap still isn't closed by the time this fires, stop
              // waiting on a backfill that may never come and go get the
              // exact missing range from the archive instead.
              if (this.syncRequestWatchdog) clearTimeout(this.syncRequestWatchdog);
              const targetHeight = latestHeight;
              this.syncRequestWatchdog = setTimeout(() => {
                this.syncRequestWatchdog = null;
                if (this.state.currentHeight < targetHeight && archiveUrl) {
                  this.log(`Hub backfill didn't close the gap (#${this.state.currentHeight} of #${targetHeight}) after ${SYNC_REQUEST_WATCHDOG_MS / 1000}s — falling back to archive`, "warn");
                  this.fetchArchiveRange(archiveUrl, this.state.currentHeight + 1, targetHeight);
                }
              }, SYNC_REQUEST_WATCHDOG_MS);
            }
          });
          break;

        case "block:backfill":
          this.processBackfill(msg.headers);
          break;

        case "block:new":
          // Live block arriving after initial sync — verify immediately.
          this.set({ syncPhase: "validating" });
          this.applyHeader(msg.header, false, () => this.set({ syncPhase: "live" }));
          break;

        case "pong":
          this.set({ latencyMs: Date.now() - this.pingSentAt });
          break;

        case "error":
          this.log(`Error: ${msg.message}`, "error");
          break;

        // ── Relay mesh signaling — Railway is the intro point only ───
        case "relay:roster": {
          this.set({ relayRoster: msg.relayNodeIds });
          // Dial anyone new in the roster who isn't us and isn't already
          // connected/connecting. Small roster (top-5) keeps this cheap.
          msg.relayNodeIds
            .filter((id) => id !== this.state.nodeId && !this.peerMesh.connectedPeerIds.includes(id))
            .forEach((id) => this.peerMesh.connectTo(id).catch(() => {
              // Common and expected — symmetric NAT on one side, peer went
              // offline mid-dial, etc. No TURN fallback by design (see
              // webrtc-peer.ts); this pair just keeps using Railway directly.
              this.log(`Peer mesh: couldn't reach ${id.slice(0, 8)}… — falling back to hub`, "warn");
            }));
          break;
        }

        case "relay:promoted":
          this.set({ isRelay: true });
          this.log("Promoted to relay node by Railway (best latency/uptime tier)");
          break;

        case "relay:demoted":
          this.set({ isRelay: false });
          this.log("Demoted from relay node (fell out of Railway's top tier)");
          break;

        case "full_sync_providers":
          this.fullSyncProviders = msg.nodeIds || [];
          break;

        case "full_sync_response":
          this.handleFullSyncResponse(msg.fromNodeId, msg.blocks || []);
          break;

        case "webrtc_offer":
          if (msg.fromNodeId) this.peerMesh.handleOffer(msg.fromNodeId, msg.sdp);
          break;

        case "webrtc_answer":
          if (msg.fromNodeId) this.peerMesh.handleAnswer(msg.fromNodeId, msg.sdp);
          break;

        case "ice_candidate":
          if (msg.fromNodeId) this.peerMesh.handleIceCandidate(msg.fromNodeId, msg.candidate);
          break;
      }
    };

    ws.onclose = () => {
      this.set({ connectionStatus: "disconnected", isRelay: false, connectedPeerIds: [] });
      this.log("Disconnected");
      this.stopHeartbeat();
      this.stopParticipationClock();
      this.stopRelayStats();
      this.peerMesh.disconnectAll();
      if (this.syncRequestWatchdog) { clearTimeout(this.syncRequestWatchdog); this.syncRequestWatchdog = null; }

      if (this.manualDisconnect) return; // user closed it — don't fight that
      const delay = withJitter(this.reconnectDelayMs);
      this.log(`Reconnecting in ${Math.round(delay / 1000)}s…`);
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
      this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, RECONNECT_MAX_MS);
    };

    ws.onerror = () => {
      this.log("Connection error", "error");
    };
  }

  disconnect() {
    this.manualDisconnect = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.ws?.close();
    this.ws = null;
    this.peerMesh.disconnectAll();
  }

  // Verifies + applies exactly one header, then calls onDone. Shared by
  // both the initial backfill (5 blocks, paced) and live block:new events.
  private applyHeader(header: any, silent: boolean = false, onDone?: () => void) {
    const result = verifyHeader(header, this.state.currentHeight, this.lastHash);
    if (!result.valid) {
      this.log(`Header REJECTED — block #${header.height} (hash ${String(header.hash).slice(0, 10)}…): ${result.reason}`, "error");
      onDone?.();
      return;
    }
    this.lastHash = header.hash;
    this.log(`Downloading block #${header.height}…`);
    this.set({ currentHeight: header.height });
    this.log(`Header Verified — block #${header.height} (${result.reason ?? "ok"})`);
    this.set({ verifiedHeaderCount: this.state.verifiedHeaderCount + 1 });
    if (!silent) this.log("Local Ledger Updated");
    this.checkEligibility();
    this.peerMesh.broadcastHeader(header); // best-effort — reduces peers' reliance on Railway alone
    putBlock(header); // fire-and-forget — see block-store.ts. Not awaited: a slow/failed IndexedDB write must never stall sync.
    this.ws?.send(JSON.stringify({
      type: "ack", nodeId: this.state.nodeId, height: header.height, timestamp: Date.now(),
    }));
    onDone?.();
  }

  // Processes the last-N backfilled headers one at a time with a short
  // delay between each, so the UI can show real "downloading N/5 →
  // validating N/5" progress instead of jumping straight to "done".
  private async processBackfill(headers: any[]) {
    if (headers.length === 0) {
      // Nothing cached on Railway yet (fresh restart) — fall through to
      // live blocks as they arrive naturally.
      this.set({ syncPhase: "live" });
      return;
    }
    this.set({ syncPhase: "downloading", syncProgress: { current: 0, total: headers.length } });

    for (let i = 0; i < headers.length; i++) {
      await new Promise((r) => setTimeout(r, STEP_DELAY_MS));
      this.set({ syncProgress: { current: i + 1, total: headers.length }, syncPhase: "downloading" });
      await new Promise((r) => setTimeout(r, STEP_DELAY_MS));
      this.set({ syncPhase: "validating" });
      this.applyHeader(headers[i], true);
    }

    this.log("Local Ledger Updated");
    this.set({ syncPhase: "live" });
    this.checkEligibility();
  }

  // Asks a random known full-sync provider (a validator daemon or another
  // full node — never another browser Light Node, which never reports
  // hasFullLedger) for [from..to], relayed blind through Railway (see
  // full_sync_request/full_sync_response in server.ts). Resolves true only
  // if the peer's response got us all the way to `to`; a timeout or a
  // short/partial response resolves false, and whatever WAS applied stays
  // applied (currentHeight only ever advances, never rolls back) — the
  // caller in the "welcome" handler picks up wherever this left off.
  private async tryPeerCatchUp(from: number, to: number): Promise<boolean> {
    if (this.fullSyncProviders.length === 0 || !this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    if (this.pendingFullSyncRequest) return false; // one in flight at a time is enough

    const peer = this.fullSyncProviders[Math.floor(Math.random() * this.fullSyncProviders.length)];
    this.log(`Requesting #${from}–#${to} from peer ${peer.slice(0, 8)}…`);

    const ok = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingFullSyncRequest = null;
        this.log(`Peer ${peer.slice(0, 8)}… timed out — falling back`, "warn");
        resolve(false);
      }, FULL_SYNC_PEER_TIMEOUT_MS);
      this.pendingFullSyncRequest = { fromNodeId: peer, resolve, timer };
      this.ws!.send(JSON.stringify({ type: "full_sync_request", toNodeId: peer, fromHeight: from, toHeight: to }));
    });

    return ok && this.state.currentHeight >= to;
  }

  private handleFullSyncResponse(fromNodeId: string, blocks: any[]) {
    // Apply in height order — applyHeader() only advances currentHeight for
    // the immediate next block, so an out-of-order or gappy batch just
    // stalls at the first hole rather than corrupting anything.
    const sorted = [...blocks].sort((a, b) => a.height - b.height);
    for (const block of sorted) {
      if (block.height !== this.state.currentHeight + 1) continue; // not next — skip, don't break the chain
      this.applyHeader(block, true);
    }
    this.log(`Peer ${fromNodeId.slice(0, 8)}… sent ${blocks.length} block(s), now at #${this.state.currentHeight}`);

    const pending = this.pendingFullSyncRequest;
    if (pending && pending.fromNodeId === fromNodeId) {
      clearTimeout(pending.timer);
      this.pendingFullSyncRequest = null;
      pending.resolve(true);
    }
  }

  // Confirms Railway's self-reported tip against Vercel's own /api/chain-height
  // (straight from Postgres) before this node commits to a sync strategy.
  // Only overrides Railway's number when Vercel reports something HIGHER —
  // if Vercel is unreachable, or reports lower/equal, Railway's figure is
  // used as-is rather than blocking sync on this one extra request.
  private async resolveNetworkTip(railwayLatestHeight: number): Promise<number> {
    const appUrl = process.env.NEXT_PUBLIC_ARCHIVE_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;
    if (!appUrl) return railwayLatestHeight;
    try {
      const res = await fetch(`${appUrl.replace(/\/$/, "")}/api/chain-height`);
      if (!res.ok) return railwayLatestHeight;
      const data = await res.json();
      if (typeof data.latestHeight === "number" && data.latestHeight > railwayLatestHeight) {
        return data.latestHeight;
      }
      return railwayLatestHeight;
    } catch {
      return railwayLatestHeight; // Vercel check failed — fall back to Railway's own number rather than stalling
    }
  }

  // Pulls headers for [currentHeight+1 .. latestHeight-RAILWAY_BACKFILL_LIMIT]
  // from the app's own archive API (backed by Postgres — see
  // src/app/api/archive/blocks/[height]/route.ts), verifies each via the
  // exact same hash-chain check used for Railway's own backfill, then
  // requests the final short tail from Railway to reach the live tip. If
  // the archive is unreachable or any fetch fails, falls back to
  // Railway's normal (possibly-truncated) backfill rather than getting stuck.
  private async catchUpFromArchive(archiveBaseUrl: string, latestHeight: number) {
    const targetHeight = latestHeight - RAILWAY_BACKFILL_LIMIT;
    const fromHeight = this.state.currentHeight + 1;

    if (targetHeight < fromHeight) {
      this.ws?.send(JSON.stringify({ type: "sync_request", nodeId: this.state.nodeId, fromHeight }));
      return;
    }

    this.log(`Gap of ${latestHeight - this.state.currentHeight} blocks exceeds hub buffer — fetching archive…`);
    await this.fetchArchiveRange(archiveBaseUrl, fromHeight, targetHeight);

    // Now ask Railway for just the recent tail to reach the true live tip.
    this.ws?.send(JSON.stringify({
      type: "sync_request", nodeId: this.state.nodeId, fromHeight: this.state.currentHeight + 1,
    }));
  }

  // Fetches and applies [fromHeight..toHeight] from the app's own Postgres-
  // backed archive API — uses /api/archive/blocks-range so a whole gap
  // costs a couple of Postgres queries total instead of 2 queries PER
  // HEIGHT (that endpoint's own doc comment has the before/after). Shared
  // by catchUpFromArchive() (gap too big for Railway's buffer by our own
  // estimate) and the sync_request watchdog above (gap looked small enough,
  // but Railway's buffer didn't actually have it — same fallback either way).
  private async fetchArchiveRange(archiveBaseUrl: string, fromHeight: number, toHeight: number) {
    const totalToFetch = toHeight - fromHeight + 1;
    if (totalToFetch <= 0) return;

    this.set({ syncPhase: "downloading", syncProgress: { current: 0, total: totalToFetch } });

    let fetchedCount = 0;
    for (let chunkFrom = fromHeight; chunkFrom <= toHeight; chunkFrom += ARCHIVE_RANGE_CHUNK) {
      const chunkTo = Math.min(chunkFrom + ARCHIVE_RANGE_CHUNK - 1, toHeight);
      let blocks: any[] = [];
      try {
        const res = await fetch(`${archiveBaseUrl.replace(/\/$/, "")}/api/archive/blocks-range?from=${chunkFrom}&to=${chunkTo}`);
        if (res.ok) {
          const body = await res.json();
          if (body?.success && Array.isArray(body.blocks)) blocks = body.blocks;
        }
      } catch {
        // Network error — same handling as a missing block below: fall
        // through to Railway's own backfill for the rest.
      }

      // Apply in height order and stop at the first hole — a gap partway
      // through means the rest can't be verified as contiguous from here.
      const byHeight = new Map<number, any>(blocks.map((b: any) => [b.height, b]));
      for (let h = chunkFrom; h <= chunkTo; h++) {
        const header = byHeight.get(h);
        if (!header) {
          this.log(`Archive missing block #${h} — falling back to hub backfill for the rest`, "warn");
          this.ws?.send(JSON.stringify({
            type: "sync_request", nodeId: this.state.nodeId, fromHeight: this.state.currentHeight + 1,
          }));
          return;
        }
        this.set({ syncPhase: "validating" });
        const { success, ...rest } = header;
        this.applyHeader(rest, true);
        fetchedCount++;
        this.set({ syncProgress: { current: fetchedCount, total: totalToFetch }, syncPhase: "downloading" });
      }
    }

    this.log(`Archive catch-up complete — ${fetchedCount} block(s) verified from archive`);
  }

  private startRelayStats() {
    this.stopRelayStats();
    this.relayStatsTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      this.ws.send(JSON.stringify({
        type: "relay_stats",
        nodeId: this.state.nodeId,
        avgLatencyMs: this.state.latencyMs ?? 0,
        participationSeconds: this.state.participationSeconds,
        verifiedHeaderCount: this.state.verifiedHeaderCount,
      }));
    }, RELAY_STATS_INTERVAL_MS);
  }

  private stopRelayStats() {
    if (this.relayStatsTimer) clearInterval(this.relayStatsTimer);
    this.relayStatsTimer = null;
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      this.pingSentAt = Date.now();
      this.ws.send(JSON.stringify({ type: "ping" }));
      this.ws.send(JSON.stringify({
        type: "heartbeat", nodeId: this.state.nodeId, height: this.state.currentHeight, timestamp: Date.now(),
      }));
      this.set({ lastHeartbeat: Date.now() });
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  // Only accrues while genuinely connected — closing/reopening the app
  // doesn't let someone fast-forward past the participation requirement.
  private startParticipationClock() {
    this.stopParticipationClock();
    this.participationTimer = setInterval(() => {
      if (this.state.connectionStatus !== "connected") return;
      this.set({ participationSeconds: this.state.participationSeconds + 1 });
      this.checkEligibility();
    }, 1000);
  }

  private stopParticipationClock() {
    if (this.participationTimer) clearInterval(this.participationTimer);
    this.participationTimer = null;
  }

  private checkEligibility() {
    if (this.state.eligible) return;
    const enoughTime = this.state.participationSeconds >= MIN_PARTICIPATION_SECONDS;
    if (enoughTime) {
      this.set({ eligible: true });
      this.log("Participation Confirmed");
      this.log("Reward Eligible");
    }
  }

  // Call this right after a successful claim so the UI/state reflects it.
  markClaimed(epochLabel: string) {
    this.set({ lastClaimEpoch: epochLabel, eligible: false, verifiedHeaderCount: 0, participationSeconds: 0 });
    this.log(`Claimed — epoch ${epochLabel}`);
  }
}

let singleton: LightNodeClient | null = null;
export function getLightNodeClient(): LightNodeClient {
  if (!singleton) {
    const url = process.env.NEXT_PUBLIC_RAILWAY_WS_URL || "";
    singleton = new LightNodeClient(url);
  }
  return singleton;
}
