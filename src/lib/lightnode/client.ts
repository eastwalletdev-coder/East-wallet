"use client"

import nacl from "tweetnacl";
import type { BlockHeader, InboundMessage } from "./protocol";

const STORAGE_KEY = "east_lightnode_state_v1";
const HEARTBEAT_MS = 20_000;
const MIN_VERIFIED_HEADERS = 2;      // lowered from 5 — empty blocks only seal
                                      // every 30min, so requiring 5 *new* headers
                                      // per session made the header gate far
                                      // stricter than the 120s participation gate.
                                      // 2 is reachable via initial backfill alone.
const MIN_PARTICIPATION_SECONDS = 120; // 2 minutes
const STEP_DELAY_MS = 600;           // pacing so the sync steps are visibly animated,
                                      // not an instant jump-cut to "done"

// Railway's WS hub only keeps a small in-memory ring buffer of recent
// headers for backfill (~20) — it's a lightweight relay, not a database.
// If our gap is bigger than that, Railway alone can't fill it (see
// verifyHeader's "accept the jump" comment below). Beyond this threshold,
// fetch the missing range from the permanent R2 archive first — see
// r2-client.ts (server write side) and catchUpFromArchive() below.
const RAILWAY_BACKFILL_LIMIT = 20;
const ARCHIVE_CONCURRENCY = 8; // parallel GETs when pulling a gap from R2

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
  log: { time: number; message: string }[];
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
  // Railway relay serving a self-consistent but fake chain. Only enforced
  // when a public key is configured AND the header carries a signature,
  // so history archived before this feature shipped still loads (logged,
  // not silently accepted as equally trustworthy).
  const chainPubKeyHex = process.env.NEXT_PUBLIC_CHAIN_SIGNING_PUBLIC_KEY;
  if (chainPubKeyHex) {
    if (!header.signature) {
      console.warn(`[LightNode] Block #${header.height} has no signature — accepted, but not cryptographically verified (pre-signing history?)`);
    } else if (!verifyChainSignature(chainPubKeyHex, header.height, header.hash, header.signature)) {
      return { valid: false, reason: "Invalid chain signature — possible tampering" };
    }
  }

  return { valid: true };
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(Math.floor(hex.length / 2));
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

function verifyChainSignature(publicKeyHex: string, height: number, blockHash: string, signatureHex: string): boolean {
  try {
    const publicKey = hexToBytes(publicKeyHex);
    const signature = hexToBytes(signatureHex);
    const message = new TextEncoder().encode(`EASTCHAIN_BLOCK|${height}|${blockHash}`);
    return nacl.sign.detached.verify(message, signature, publicKey);
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
  private lastHash: string | null = null;
  private pingSentAt = 0;
  private url: string;

  constructor(url: string) {
    this.url = url;
    this.state = loadState();
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

  private log(message: string) {
    const entry = { time: Date.now(), message };
    const log = [...this.state.log, entry].slice(-50);
    this.set({ log });
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.set({ connectionStatus: "connecting" });
    this.log("Connecting…");

    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.set({ connectionStatus: "connected" });
      this.log("Connected");
      ws.send(JSON.stringify({ type: "hello", role: "light-node", nodeId: this.state.nodeId }));
      this.startHeartbeat();
      this.startParticipationClock();
    };

    ws.onmessage = (ev) => {
      let msg: InboundMessage;
      try { msg = JSON.parse(ev.data); } catch { return; }

      switch (msg.type) {
        case "welcome":
          this.set({ syncPhase: "downloading" });
          this.log("Synchronization Started");
          if (msg.latestHeight >= 0) {
            this.log(`Network tip is block #${msg.latestHeight}`);
          }
          {
            const gap = msg.latestHeight - this.state.currentHeight;
            const archiveUrl = process.env.NEXT_PUBLIC_ARCHIVE_BASE_URL;
            if (gap > RAILWAY_BACKFILL_LIMIT + 1 && archiveUrl) {
              // Gap bigger than Railway's ring buffer can cover — pull the
              // older portion from the permanent R2 archive first, then
              // let Railway's normal backfill handle just the recent tail.
              this.catchUpFromArchive(archiveUrl, msg.latestHeight);
            } else {
              this.ws?.send(JSON.stringify({
                type: "sync_request", nodeId: this.state.nodeId, fromHeight: this.state.currentHeight + 1,
              }));
            }
          }
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
          this.log(`Error: ${msg.message}`);
          break;
      }
    };

    ws.onclose = () => {
      this.set({ connectionStatus: "disconnected" });
      this.log("Disconnected");
      this.stopHeartbeat();
      this.stopParticipationClock();
    };

    ws.onerror = () => {
      this.log("Connection error");
    };
  }

  disconnect() {
    this.ws?.close();
    this.ws = null;
  }

  // Verifies + applies exactly one header, then calls onDone. Shared by
  // both the initial backfill (5 blocks, paced) and live block:new events.
  private applyHeader(header: any, silent: boolean = false, onDone?: () => void) {
    const result = verifyHeader(header, this.state.currentHeight, this.lastHash);
    if (!result.valid) {
      this.log(`Header rejected: ${result.reason}`);
      onDone?.();
      return;
    }
    this.lastHash = header.hash;
    this.log(`Downloading block #${header.height}…`);
    this.set({ currentHeight: header.height });
    this.log(`Header Verified — block #${header.height}`);
    this.set({ verifiedHeaderCount: this.state.verifiedHeaderCount + 1 });
    if (!silent) this.log("Local Ledger Updated");
    this.checkEligibility();
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

  // Pulls headers for [currentHeight+1 .. latestHeight-RAILWAY_BACKFILL_LIMIT]
  // from the permanent R2 archive (one small immutable object per height,
  // see r2-client.ts), verifies each via the exact same hash-chain check
  // used for Railway's own backfill, then requests the final short tail
  // from Railway to reach the live tip. If the archive is unreachable or
  // any fetch fails, falls back to Railway's normal (possibly-truncated)
  // backfill rather than getting stuck.
  private async catchUpFromArchive(archiveBaseUrl: string, latestHeight: number) {
    const targetHeight = latestHeight - RAILWAY_BACKFILL_LIMIT;
    const fromHeight = this.state.currentHeight + 1;
    const totalToFetch = targetHeight - fromHeight + 1;

    if (totalToFetch <= 0) {
      this.ws?.send(JSON.stringify({ type: "sync_request", nodeId: this.state.nodeId, fromHeight }));
      return;
    }

    this.log(`Gap of ${latestHeight - this.state.currentHeight} blocks exceeds hub buffer — fetching archive from R2…`);
    this.set({ syncPhase: "downloading", syncProgress: { current: 0, total: totalToFetch } });

    const heights: number[] = [];
    for (let h = fromHeight; h <= targetHeight; h++) heights.push(h);

    let fetchedCount = 0;
    for (let i = 0; i < heights.length; i += ARCHIVE_CONCURRENCY) {
      const batch = heights.slice(i, i + ARCHIVE_CONCURRENCY);
      const results = await Promise.all(
        batch.map(async (h) => {
          try {
            const res = await fetch(`${archiveBaseUrl.replace(/\/$/, "")}/blocks/${h}.json`);
            if (!res.ok) return { h, header: null };
            return { h, header: await res.json() };
          } catch {
            return { h, header: null };
          }
        })
      );

      for (const { h, header } of results) {
        if (!header) {
          // Missing/unreachable object — stop trusting the archive from
          // here on and let Railway's normal (possibly partial) backfill
          // take over for whatever remains. Not treated as tampering.
          this.log(`Archive missing block #${h} — falling back to hub backfill for the rest`);
          this.ws?.send(JSON.stringify({
            type: "sync_request", nodeId: this.state.nodeId, fromHeight: this.state.currentHeight + 1,
          }));
          return;
        }
        this.set({ syncPhase: "validating" });
        this.applyHeader(header, true);
        fetchedCount++;
        this.set({ syncProgress: { current: fetchedCount, total: totalToFetch }, syncPhase: "downloading" });
      }
    }

    this.log(`Archive catch-up complete — ${fetchedCount} block(s) verified from R2`);
    // Now ask Railway for just the recent tail to reach the true live tip.
    this.ws?.send(JSON.stringify({
      type: "sync_request", nodeId: this.state.nodeId, fromHeight: this.state.currentHeight + 1,
    }));
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
