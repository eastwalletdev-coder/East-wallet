"use client"

import type { BlockHeader, InboundMessage } from "./protocol";

const STORAGE_KEY = "east_lightnode_state_v1";
const HEARTBEAT_MS = 20_000;
const MIN_VERIFIED_HEADERS = 5;      // stand-in for "5 epochs" until historical
                                      // backfill (RPC) exists — see README note
const MIN_PARTICIPATION_SECONDS = 120; // 2 minutes
const STEP_DELAY_MS = 600;           // pacing so the sync steps are visibly animated,
                                      // not an instant jump-cut to "done"

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
    if (header.height !== prevHeight + 1) return { valid: false, reason: "Invalid block height" };
    if (prevHash && header.previousHash !== prevHash) return { valid: false, reason: "Previous hash mismatch" };
  }
  return { valid: true };
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
          this.ws?.send(JSON.stringify({
            type: "sync_request", nodeId: this.state.nodeId, fromHeight: this.state.currentHeight + 1,
          }));
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
    const enoughHeaders = this.state.verifiedHeaderCount >= MIN_VERIFIED_HEADERS;
    const enoughTime = this.state.participationSeconds >= MIN_PARTICIPATION_SECONDS;
    if (enoughHeaders && enoughTime) {
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
