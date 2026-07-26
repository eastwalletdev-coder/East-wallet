"use client"

import { verifyMessage } from "ethers";
import type { BlockHeader, InboundMessage, NodeTier } from "./protocol";
import { EAST_CHAIN_ID } from "@/lib/contracts/registry";
import { PeerMesh } from "./webrtc-peer";
import { putBlock } from "./block-store";

const STORAGE_KEY = "east_lightnode_state_v1";
// Separate key (not part of the main state blob, which persist()s on every
// single set() call) for a small cross-restart peer cache — see
// loadPeerCache()/savePeerCache() below. Written on its own, coarser
// cadence instead, since it doesn't need to track every state change.
const PEER_CACHE_STORAGE_KEY = "east_lightnode_peer_cache_v1";
const PEER_CACHE_MAX_ENTRIES = 20;
const HEARTBEAT_MS = 5 * 60_000; // was 20s — that was the real bandwidth driver at scale (see the "1.15 miliar pesan/hari" math), not tier assignment. 5 min is still frequent enough for reward/participation tracking; the native WS ping/pong on the hub side (30s) still catches a genuinely-dead socket long before this would.
const RELAY_STATS_INTERVAL_MS = 5 * 60_000; // was 30s — same reasoning as HEARTBEAT_MS above
const REBOOTSTRAP_COOLDOWN_MS = 2 * 60_000; // minimum gap between bootstrap_request re-asks when the mesh is empty

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
const DRIFT_RECHECK_INTERVAL_MS = 3 * 60_000; // browser-side equivalent of full-node-sync.js's periodic recheck — a missed live push self-heals within this interval instead of requiring a manual reconnect
const PEER_EXCHANGE_INTERVAL_MS = 90_000; // how often we ask connected peers "who else do you know?" — deliberately NOT stopped when Railway disconnects, see startPeerExchange()
const MESH_EXPANSION_INTERVAL_MS = 45_000; // how often we try turning a knownPeers hint into an actual connection — see startMeshExpansion()

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
  networkTipHeight: number; // last known real chain tip (from Vercel's /api/chain-height, via resolveNetworkTip) — lets the UI show "#current of #tip" instead of just an abstract per-batch counter that resets every fetch and doesn't tell you how far from done you actually are
  verifiedHeaderCount: number;
  participationSeconds: number;
  lastHeartbeat: number | null;
  lastClaimEpoch: string | null;
  latencyMs: number | null;
  eligible: boolean;
  log: { time: number; message: string; level?: "info" | "warn" | "error" }[];
  // WebRTC peer mesh — Railway is still the only introduction point; this
  // is just which peers we've since connected to directly. See webrtc-peer.ts.
  tier: NodeTier;                 // our position in Railway's Leader/Guardian/Broadcaster/Vision hierarchy
  parentNodeId: string | null;    // the ONE peer we dial to receive gossip (null for leader/none — see runCatchUp)
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
      tier: "none",
      parentNodeId: null,
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
    networkTipHeight: -1,
    verifiedHeaderCount: 0,
    participationSeconds: 0,
    lastHeartbeat: null,
    lastClaimEpoch: null,
    latencyMs: null,
    eligible: false,
    log: [],
    tier: "none",
    parentNodeId: null,
    connectedPeerIds: [],
  };
}

function persist(state: LightNodeState) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}

// Cross-restart peer cache: without this, PeerMesh's knownPeers (and the
// connections it took a live PEX round or two to build) are pure in-memory
// state — gone the instant the Telegram Mini App WebView reloads, which
// (per the disconnect/reconnect investigation earlier) happens often on
// mobile. Every fresh launch would otherwise start from zero peer
// knowledge every single time, relying entirely on Railway's bootstrap_peers
// being reachable at that exact moment. This doesn't remove that
// dependency for a genuinely first-ever launch (there's nothing to seed
// from yet) — it only helps a RETURNING node skip straight to trying
// peers it already had some relationship with, in parallel with whatever
// fresh sample Railway hands it this time.
function loadPeerCache(): { nodeId: string; viaPeerId: string }[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(PEER_CACHE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e) => e && typeof e.nodeId === "string")
      .slice(0, PEER_CACHE_MAX_ENTRIES)
      .map((e) => ({ nodeId: e.nodeId, viaPeerId: typeof e.viaPeerId === "string" ? e.viaPeerId : "" }));
  } catch {
    return [];
  }
}

function savePeerCache(entries: { nodeId: string; viaPeerId: string }[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PEER_CACHE_STORAGE_KEY, JSON.stringify(entries.slice(0, PEER_CACHE_MAX_ENTRIES)));
  } catch {}
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
  private turnRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(url: string) {
    this.url = url;
    this.state = loadState();
    this.peerMesh = new PeerMesh(this.state.nodeId, {
      // Guarded on readyState now (not just ws existing) — mesh expansion
      // (see startMeshExpansion()) can attempt connectTo() with no relay
      // hint available while Railway is down, in which case this is the
      // path that would otherwise throw trying to send on a closed socket.
      // A no-op here is correct: the offer just never reaches anyone and
      // that attempt quietly times out, same as any other unreachable peer.
      sendSignal: (msg) => { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg)); },
      onPeerHeader: (peerNodeId, header) => {
        // Same trust boundary as a Railway-sourced header — verifyHeader()
        // inside applyHeader() doesn't know or care which transport it came
        // from. A peer can only waste bandwidth by sending junk, never get
        // an unverified header accepted. silent:true keeps this out of the
        // "Local Ledger Updated" log (it's a relay, not our own new find),
        // but sourcePeerId still gets it forwarded to our OTHER connected
        // peers (down the tree) — see applyHeader's broadcast condition.
        this.applyHeader(header, true, undefined, peerNodeId);
      },
      onPeerConnected: (peerNodeId) => {
        this.log(`Peer mesh: connected to ${peerNodeId.slice(0, 8)}…`);
        this.set({ connectedPeerIds: this.peerMesh.connectedPeerIds });
        this.savePeerCacheSnapshot();
        // Without this, a freshly-dialed parent (e.g. right after a
        // tier:assign) only helps once it happens to broadcast its NEXT
        // new live block — anything it already has from before the
        // connection opened just sits there until the up-to-3-minute
        // drift recheck eventually calls requestRange(). That's what
        // looked like a "guardian just sitting there not downloading"
        // bug: the connection itself was fine, nothing had asked it for
        // anything yet. Ask right away instead of waiting.
        this.triggerImmediateCatchUp();
      },
      onPeerDisconnected: (peerNodeId) => {
        this.log(`Peer mesh: disconnected from ${peerNodeId.slice(0, 8)}…`);
        this.set({ connectedPeerIds: this.peerMesh.connectedPeerIds });
      },
    });

    // Rehydrate from the last session's peer cache immediately — before
    // Railway has even had a chance to respond to "hello" with its own
    // bootstrap_peers sample. If Railway happens to be unreachable right
    // at this launch, these are the only candidates mesh-expansion has to
    // try; if Railway IS reachable, this just means a couple of extra
    // (likely-still-good) connection attempts run in parallel with the
    // fresh sample, which is harmless.
    this.peerMesh.seedKnownPeers(loadPeerCache());

    // TURN credentials come from Vercel, not Railway — fetch them right
    // away regardless of the hub's connection state, so a NAT-restricted
    // peer pair has the best chance of actually establishing, including
    // during peer-relayed signaling while Railway is down.
    this.fetchIceServers();
  }

  // Fetches short-lived TURN credentials (see /api/turn-credentials) and
  // hands them to peerMesh. If TURN isn't configured on this deployment,
  // `configured: false` comes back and this quietly does nothing — every
  // RTCPeerConnection stays STUN-only, exactly as before this existed.
  // Reschedules itself before the minted credential expires so a
  // long-running session never tries a fresh connection with a stale one.
  private async fetchIceServers() {
    if (typeof window === "undefined" || typeof fetch === "undefined") return;
    const appUrl = process.env.NEXT_PUBLIC_ARCHIVE_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || "";
    try {
      const res = await fetch(`${appUrl.replace(/\/$/, "")}/api/turn-credentials`);
      if (!res.ok) return;
      const body = await res.json();
      if (!body?.configured) return; // no TURN server set up on this deployment — stay STUN-only
      // Route already returns an RTCIceServer[] (Metered hands back the
      // whole array pre-shaped) — pass it straight through.
      this.peerMesh.setTurnServers(Array.isArray(body.iceServers) ? body.iceServers : []);
      const refreshInMs = Math.max((body.ttlSeconds ?? 3600) * 1000 * 0.8, 60_000);
      if (this.turnRefreshTimer) clearTimeout(this.turnRefreshTimer);
      this.turnRefreshTimer = setTimeout(() => this.fetchIceServers(), refreshInMs);
    } catch {
      // Network hiccup fetching TURN creds — harmless. This session just
      // stays STUN-only until the next attempt; nothing else depends on it.
    }
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
      this.startDriftRecheck();
      if (!this.pexTimer) this.startPeerExchange(); // only start once — a reconnect shouldn't reset an already-running PEX cycle
      if (!this.meshExpansionTimer) this.startMeshExpansion(); // same — runs independent of Railway's own up/down state
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
          this.resolveNetworkTip(msg.latestHeight).then((latestHeight) => this.runCatchUp(latestHeight));
          break;

        case "block:backfill":
          this.processBackfill(msg.headers);
          break;

        case "block:new":
          // Live block arriving after initial sync — verify immediately.
          this.set({ syncPhase: "validating" });
          if (msg.header?.height > this.state.networkTipHeight) {
            this.set({ networkTipHeight: msg.header.height });
          }
          this.applyHeader(msg.header, false, () => this.set({ syncPhase: "live" }));
          break;

        case "pong":
          this.set({ latencyMs: Date.now() - this.pingSentAt });
          break;

        case "error":
          this.log(`Error: ${msg.message}`, "error");
          break;

        // ── Tier hierarchy signaling — Railway is the intro point only ──
        case "tier:assign": {
          const previousParent = this.state.parentNodeId;
          const previousTier = this.state.tier;
          this.set({ tier: msg.tier, parentNodeId: msg.parentNodeId });
          this.log(`Tier assigned: ${msg.tier}${msg.parentNodeId ? ` (parent: ${msg.parentNodeId.slice(0, 8)}…)` : ""}`);

          if (previousParent && previousParent !== msg.parentNodeId) {
            // Our position in the tree moved — the old parent link is no
            // longer meaningful, drop it rather than keep an idle socket.
            this.peerMesh.disconnect(previousParent);
          }
          if (msg.parentNodeId && !this.peerMesh.connectedPeerIds.includes(msg.parentNodeId)) {
            // Railway just told us this over the WS, so it's up right now —
            // no relay hint needed here, this is the normal path. The relay
            // path (see startMeshExpansion) is for reaching knownPeers WHILE
            // Railway is down, which by definition can't be how we just
            // received a tier:assign.
            this.peerMesh.connectTo(msg.parentNodeId).catch(() => {
              // Common and expected — symmetric NAT on one side, parent went
              // offline mid-dial, etc. No TURN fallback by design (see
              // webrtc-peer.ts); we fall back to Railway/archive directly
              // per runCatchUp()'s "zero peers" bootstrap path until the
              // next rescore assigns a reachable parent.
              this.log(`Tier mesh: couldn't reach parent ${msg.parentNodeId!.slice(0, 8)}… — falling back to hub`, "warn");
            });
          }

          // Becoming Leader (or "none") means we're now the one RESPONSIBLE
          // for going to Railway/the validator/the archive ourselves —
          // without this, a freshly-promoted node just sat there with the
          // right tier but no active fetch until the next scheduled drift
          // recheck (up to 3 minutes later), which is exactly the "promoted
          // but still not downloading" symptom.
          const justBecameResponsible = previousTier !== "leader" && previousTier !== "none"
            && (msg.tier === "leader" || msg.tier === "none");
          if (justBecameResponsible) {
            this.triggerImmediateCatchUp();
          }
          break;
        }

        case "full_sync_providers":
          this.fullSyncProviders = msg.nodeIds || [];
          break;

        // ── Bootstrap discovery — see railway-server's sampleBootstrapPeers() ──
        // Arrives right after "welcome" (or after we explicitly re-ask, see
        // maybeRebootstrap()). Dial a handful in parallel rather than one at
        // a time — some will be unreachable (NAT, since gone offline), and
        // having several attempts in flight means we still end up with
        // peers even if most of them fail, without waiting out each one
        // sequentially first. Once any of these opens, PEX + mesh expansion
        // take over growing the mesh further on their own.
        case "bootstrap_peers": {
          const candidates = (msg.nodeIds || [])
            .filter((id) => !this.peerMesh.connectedPeerIds.includes(id))
            .slice(0, 3);
          if (candidates.length > 0) {
            this.log(`Bootstrap: dialing ${candidates.length} peer(s) from Railway's sample`);
          }
          for (const nodeId of candidates) {
            this.peerMesh.connectTo(nodeId).catch(() => {
              this.log(`Bootstrap: couldn't reach ${nodeId.slice(0, 8)}…`, "warn");
            });
          }
          break;
        }

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
      // Only the Railway signaling/relay connection is gone here — NOT the
      // WebRTC peer mesh. Those DataChannels are already direct P2P links
      // (see webrtc-peer.ts's header comment) that never route through
      // Railway once established, so there's no technical reason to kill
      // them just because Railway had a hiccup. Previously this called
      // peerMesh.disconnectAll() unconditionally, which meant a single
      // Railway outage instantly dropped every peer too — the opposite of
      // what a resilient mesh should do. Peers we're still actually
      // connected to keep gossiping headers, serving backfill, etc. the
      // entire time Railway is down; only a genuinely failed/closed RTCPeerConnection
      // (handled independently in webrtc-peer.ts's onconnectionstatechange)
      // removes a peer now. tier/parentNodeId/connectedPeerIds are left as
      // they were for the same reason — they still describe the mesh
      // that's still alive, Railway just isn't here to confirm it anymore.
      this.set({ connectionStatus: "disconnected" });
      this.log("Disconnected from hub — peer mesh stays up if any peers are still connected", "warn");
      this.stopHeartbeat();
      this.stopParticipationClock();
      this.stopRelayStats();
      this.stopDriftRecheck();
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

  // The full catch-up sequence: peer-mesh (WebRTC lightnodes) → validator
  // full node → archive/Railway backfill. Called once at connect (from the
  // "welcome" handler) AND periodically (see startDriftRecheck below) —
  // previously this only ever ran once per connection, so a browser tab
  // that stayed connected but simply never received a live block:new (a
  // missed Railway push, or two lightnodes peer-connected to each other
  // but neither actually getting fresh pushes from Railway to relay)
  // would silently drift behind forever, "noticing" only when something
  // forced a reconnect. This is the browser-side equivalent of
  // full-node-sync.js's _recheckDrift() on the validator/Termux side.
  //
  // TIER HIERARCHY: steps 2-3 (validator eksternal, archive, Railway's own
  // sync_request) are gated to Leader-tier nodes only (see tier:assign
  // above and railway-server's recomputeTiers). Railway ranks every
  // connected lightnode by score+latency into Leader(1) -> Guardian(20) ->
  // Broadcaster(400) -> Vision(8000), each node dialing exactly ONE parent
  // via WebRTC. So instead of every one of however many thousand
  // lightnodes independently hitting Railway/the validator/the Postgres
  // archive, only the single Leader does — a new block flows Leader ->
  // its 20 Guardians -> their 400 Broadcasters -> their 8000 Visions, 3
  // WebRTC hops instead of thousands of direct hits. "none" tier (unranked
  // — brand new, or more nodes than the ~8421 tree currently holds) also
  // falls through to Railway/archive/validator directly, same as before
  // tiers existed — there's nobody assigned for them to wait on yet. A
  // brand-new node needing #0-latest asks the SAME requestRange() as
  // anyone else, which broadcasts to every connected peer, not just its
  // parent — so it can be answered by whichever peer(s) happen to have
  // that range.
  private async runCatchUp(latestHeight: number) {
    if (latestHeight >= 0) {
      this.log(`Network tip is block #${latestHeight}`);
      this.set({ networkTipHeight: latestHeight });
      this.checkEligibility();
    }
    const gap = latestHeight - this.state.currentHeight;
    const archiveUrl = process.env.NEXT_PUBLIC_ARCHIVE_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;

    if (gap > PEER_AND_ARCHIVE_TRIGGER_GAP + 1) {
      // Step 1 of 3: other lightnodes first (WebRTC mesh, see
      // webrtc-peer.ts's requestRange + block-store.ts) — tried by
      // EVERY node regardless of relay status. Spreads catch-up load
      // across whoever's already connected and happens to have this
      // range in their own last-5000-block IndexedDB cache — costs
      // Railway/Vercel nothing at all. Only the contiguous run from
      // currentHeight+1 is applied; the loop stops at the first hole
      // so whatever's still missing correctly falls through below.
      const peerBlocks = await this.peerMesh.requestRange(
        this.state.currentHeight + 1, latestHeight, LIGHTNODE_PEER_GOSSIP_TIMEOUT_MS
      );
      if (peerBlocks.length > 0) {
        const byHeight = new Map<number, any>(peerBlocks.map((b: any) => [b.height, b]));
        let appliedFromPeers = 0;
        for (let h = this.state.currentHeight + 1; h <= latestHeight; h++) {
          const header = byHeight.get(h);
          if (!header) break;
          this.applyHeader(header, true, undefined, undefined, true); // force-propagate: this is closing a real gap toward the tip, not quiet initial backfill
          appliedFromPeers++;
        }
        if (appliedFromPeers > 0) {
          this.log(`Caught up ${appliedFromPeers} block(s) from lightnode peers via WebRTC`);
        }
      }

      const stillBehindAfterPeers = latestHeight - this.state.currentHeight > 0;
      const hasPeers = this.peerMesh.connectedPeerIds.length > 0;
      if (stillBehindAfterPeers && !this.canGoDirectToRailway() && hasPeers) {
        // Not our job: we're a Guardian/Broadcaster/Vision connected to our
        // parent (or other peers) but they don't have this range yet
        // either — only the Leader (or an unranked "none" node with nobody
        // to wait on) goes further, so load stays concentrated on the top
        // of the tree instead of every connected lightnode. We'll pick up
        // the rest via peer gossip on the next drift recheck once our
        // parent has it.
        this.log(`Still ${latestHeight - this.state.currentHeight} block(s) behind — waiting for tier ${this.state.tier}'s parent to catch up (not hitting Railway/archive/validator directly)`);
        return;
      }
      // Reached only if we're Leader/none-tier (this is our job), or we
      // have zero connected peers at all (bootstrap — nobody else to wait
      // on, e.g. we're among the very first nodes on the network).

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
    // buffer for whatever's left) — same tier gate as step 2.
    const remainingGap = latestHeight - this.state.currentHeight;
    if (remainingGap > 0 && !this.canGoDirectToRailway() && this.peerMesh.connectedPeerIds.length > 0) {
      return; // same reasoning as above
    }
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
  }

  private driftRecheckTimer: ReturnType<typeof setInterval> | null = null;
  private pexTimer: ReturnType<typeof setInterval> | null = null;
  private meshExpansionTimer: ReturnType<typeof setInterval> | null = null;
  private driftRecheckInFlight = false;

  // Called right when a new WebRTC peer connection opens (see
  // onPeerConnected above) — asks that peer (and anyone else connected)
  // for whatever we're missing immediately, instead of waiting for the
  // next scheduled drift recheck. Shares the same in-flight guard so this
  // never runs concurrently with a periodic recheck.
  private async triggerImmediateCatchUp() {
    if (this.driftRecheckInFlight) return;
    this.driftRecheckInFlight = true;
    try {
      const latestHeight = await this.resolveNetworkTip(-1);
      if (latestHeight > this.state.currentHeight) {
        await this.runCatchUp(latestHeight);
      }
    } finally {
      this.driftRecheckInFlight = false;
    }
  }

  private startDriftRecheck() {
    this.stopDriftRecheck();
    this.driftRecheckTimer = setInterval(async () => {
      if (this.driftRecheckInFlight) return; // don't overlap a still-running recheck
      this.driftRecheckInFlight = true;
      try {
        const latestHeight = await this.resolveNetworkTip(-1);
        if (latestHeight > this.state.currentHeight) {
          this.log(`Drift recheck: local tip is ${latestHeight - this.state.currentHeight} block(s) behind #${latestHeight} — a live update was likely missed. Catching up.`);
          await this.runCatchUp(latestHeight);
        }
      } finally {
        this.driftRecheckInFlight = false;
      }
    }, DRIFT_RECHECK_INTERVAL_MS);
  }

  // Only the Leader (top of the tier tree, no parent to wait on by
  // definition) and "none" (unranked — brand new, or overflow past the
  // ~168421-node tree) are allowed to hit Railway/the validator/the archive
  // directly. Guardian/Broadcaster/Vision/Echo wait on their single parent
  // instead — see runCatchUp()'s two gate checks that call this.
  private canGoDirectToRailway(): boolean {
    return this.state.tier === "leader" || this.state.tier === "none";
  }

  private stopDriftRecheck() {
    if (this.driftRecheckTimer) clearInterval(this.driftRecheckTimer);
    this.driftRecheckTimer = null;
  }

  disconnect() {
    this.manualDisconnect = true;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.stopDriftRecheck();
    this.stopPeerExchange();
    this.stopMeshExpansion();
    if (this.turnRefreshTimer) { clearTimeout(this.turnRefreshTimer); this.turnRefreshTimer = null; }
    this.ws?.close();
    this.ws = null;
    this.peerMesh.disconnectAll();
  }

  // Verifies + applies exactly one header, then calls onDone. Shared by
  // both the initial backfill (5 blocks, paced) and live block:new events.
  // propagate defaults from (silent, sourcePeerId) so every existing call
  // site keeps behaving exactly as before without being touched — only the
  // catch-up call sites below (archive fetch, peer range-request, Railway-
  // mediated full_sync_response) now pass it explicitly. Those three are
  // "we were behind the real tip and just closed the gap via some indirect
  // path" — genuinely new information relative to when this run started,
  // worth gossiping onward — as opposed to processBackfill()'s initial
  // 5-block sync on connect, which stays quiet (everyone's mesh peers were
  // likely already at that height ages ago, so re-broadcasting it is just
  // noise). Without this, a node that only learned of new blocks via
  // archive/peer catch-up (e.g. because Railway was down) never passed
  // that knowledge on to ITS OWN connected peers — each node had to
  // rediscover the same gap independently, which defeated the entire
  // point of the peer mesh during a Railway outage.
  private applyHeader(
    header: any,
    silent: boolean = false,
    onDone?: () => void,
    sourcePeerId?: string,
    propagate: boolean = !silent || !!sourcePeerId
  ) {
    const result = verifyHeader(header, this.state.currentHeight, this.lastHash);
    if (!result.valid) {
      // "Stale or duplicate" is the EXPECTED outcome when two lightnodes
      // are peer-mesh-connected and both already have overlapping history
      // — e.g. this node just range-caught-up from peer A, then peer B
      // (who has the same range) gossips the same headers over. That's
      // not a problem: it's just confirming we already have it. Logging
      // it at "error" made a harmless, common event look like something
      // was broken. Genuine failures (bad hash chain, bad signature)
      // still log loud, since those DO mean something is wrong.
      const benign = result.reason === "Stale or duplicate block height";
      this.log(
        `Header ${benign ? "skipped" : "REJECTED"} — block #${header.height} (hash ${String(header.hash).slice(0, 10)}…): ${result.reason}`,
        benign ? "info" : "error"
      );
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
    if (propagate) {
      // Forward onward to our connected peers (Leader -> Guardian ->
      // Broadcaster -> Vision fan-out, or just "whoever else I'm connected
      // to" outside the tier tree). sourcePeerId, when set, is excluded so
      // this doesn't echo straight back to whoever just sent it to us.
      this.peerMesh.broadcastHeader(header, sourcePeerId);
    }
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
      this.applyHeader(block, true, undefined, fromNodeId); // sourcePeerId set -> propagates onward (default), excluding an echo back to fromNodeId
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
        this.applyHeader(rest, true, undefined, undefined, true); // force-propagate — same reasoning as the peer-range case above: this closes a gap to the real tip via archive precisely because Railway/peers couldn't, so it's this node's turn to be the one that hands it to ITS mesh peers
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

  // Peer Exchange (see webrtc-peer.ts's header comment) — purely a
  // DataChannel operation between already-connected peers, so unlike every
  // other startX()/stopX() pair here, this one is deliberately NOT stopped
  // in ws.onclose. The whole point is that the mesh keeps discovering/
  // confirming its own shape independent of whether Railway is reachable
  // right now. Only the intentional, user-initiated disconnect() call
  // below stops it.
  private startPeerExchange() {
    this.stopPeerExchange();
    this.pexTimer = setInterval(() => {
      if (this.peerMesh.connectedPeerIds.length === 0) return; // nobody to ask, nothing to do
      this.peerMesh.requestPeerList();
      this.savePeerCacheSnapshot(); // periodic refresh even if no connect/disconnect event fired this cycle (e.g. knownPeers grew via gossip alone)
    }, PEER_EXCHANGE_INTERVAL_MS);
  }

  // Snapshots current connected peers + knownPeers hints into the
  // cross-restart cache (see loadPeerCache() for why). Directly-connected
  // peers are listed first (viaPeerId "" — no relay needed, we're already
  // talking to them) since they're the strongest candidates for next
  // launch; knownPeers hints fill the remaining slots.
  private savePeerCacheSnapshot() {
    const connected = this.peerMesh.connectedPeerIds.map((nodeId) => ({ nodeId, viaPeerId: "" }));
    const hints = this.peerMesh.knownPeerEntries.filter(
      (kp) => !this.peerMesh.connectedPeerIds.includes(kp.nodeId)
    );
    savePeerCache([...connected, ...hints].slice(0, PEER_CACHE_MAX_ENTRIES));
  }

  private stopPeerExchange() {
    if (this.pexTimer) clearInterval(this.pexTimer);
    this.pexTimer = null;
  }

  // Turns a knownPeers hint (someone a connected peer vouched for) into an
  // actual connection attempt. Like startPeerExchange, deliberately NOT
  // stopped on ws.onclose — the whole point is that the mesh keeps
  // discovering AND growing while Railway is down, not just holding onto
  // the connections it already had. When Railway IS up, this still runs but
  // without a relay hint, so it behaves like the old tier-only connection
  // behavior for anything PEX happens to have surfaced early — harmless,
  // just an extra path to the same graph Railway would've assigned anyway.
  private startMeshExpansion() {
    this.stopMeshExpansion();
    this.meshExpansionTimer = setInterval(() => {
      if (this.peerMesh.connectedPeerIds.length === 0) {
        this.maybeRebootstrap();
        return; // nothing in knownPeers is reachable either if we have zero direct links
      }
      const hubUp = this.ws?.readyState === WebSocket.OPEN;
      const candidate = this.peerMesh.knownPeerEntries.find(
        (kp) => !this.peerMesh.connectedPeerIds.includes(kp.nodeId)
      );
      if (!candidate) return;
      // One attempt per tick on purpose — avoids a burst of simultaneous
      // offers (and simultaneous relay traffic through the same voucher)
      // the moment a bunch of knownPeers entries show up at once.
      this.peerMesh
        .connectTo(candidate.nodeId, hubUp ? undefined : candidate.viaPeerId)
        .catch(() => {
          this.log(`Mesh expansion: couldn't reach ${candidate.nodeId.slice(0, 8)}… via ${candidate.viaPeerId.slice(0, 8)}…`, "warn");
        });
    }, MESH_EXPANSION_INTERVAL_MS);
  }

  // Re-asks Railway for a fresh bootstrap sample once our peer mesh has
  // fully collapsed to zero (knownPeers is empty too at that point, since
  // it's only ever populated by peers we're — or were recently — connected
  // to). Throttled: if the whole network genuinely has nobody else on it
  // right now, retrying every 45s forever would just be noise on Railway
  // for no benefit — REBOOTSTRAP_COOLDOWN_MS spaces attempts out instead.
  private lastRebootstrapAt = 0;
  private maybeRebootstrap() {
    if (this.ws?.readyState !== WebSocket.OPEN) return; // needs Railway up, same as the original bootstrap
    if (Date.now() - this.lastRebootstrapAt < REBOOTSTRAP_COOLDOWN_MS) return;
    this.lastRebootstrapAt = Date.now();
    this.log("Peer mesh empty — re-requesting a bootstrap sample");
    this.ws.send(JSON.stringify({ type: "bootstrap_request" }));
  }

  private stopMeshExpansion() {
    if (this.meshExpansionTimer) clearInterval(this.meshExpansionTimer);
    this.meshExpansionTimer = null;
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
    const enoughTime = this.state.participationSeconds >= MIN_PARTICIPATION_SECONDS;
    // networkTipHeight starts at -1 (not yet resolved) — don't let that
    // trivially satisfy "caught up" via -1 >= -1. Claim eligibility must
    // wait until we actually know the real tip and have reached it.
    const tipKnown = this.state.networkTipHeight >= 0;
    const caughtUp = tipKnown && this.state.currentHeight >= this.state.networkTipHeight;
    const nowEligible = enoughTime && caughtUp;
    if (nowEligible === this.state.eligible) return;
    this.set({ eligible: nowEligible });
    if (nowEligible) {
      this.log("Participation Confirmed");
      this.log("Reward Eligible");
    } else if (enoughTime && !caughtUp) {
      // Only log the "fell behind" case, not every tick before enoughTime.
      this.log(`Fell behind tip (#${this.state.currentHeight} of #${this.state.networkTipHeight}) — claim locked until caught up`);
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
