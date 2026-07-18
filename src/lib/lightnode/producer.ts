"use client";

/**
 * EASTCHAIN — Light Node Producer (browser)
 * ─────────────────────────────────────────────────────────────────────
 * Browser port of scripts/block-producer-daemon.js, using the same
 * self-custody vault as SelfCustodyMigrationSheet.tsx (east-self-custody.ts)
 * instead of a local vault file, and block-math-browser.ts (Web Crypto)
 * instead of Node's `crypto` module.
 *
 * What it does, while running:
 *   1. Sends a heartbeat every HEARTBEAT_INTERVAL_MS to /api/node/heartbeat,
 *      signed with the self-custody key — this is what makes this node
 *      show up in getActiveExternalValidators() (identity.ts), ranked by
 *      whatever PoC score it has (0 if never elected — see
 *      leader-schedule.ts's header comment on the score-priority design).
 *   2. Polls GET /api/consensus/my-proposal every POLL_PROPOSAL_INTERVAL_MS
 *      to check if THIS node is currently the assigned leader.
 *   3. When assigned: computes merkleRoot/sequenceHash/blockHash locally
 *      (block-math-browser.ts — must stay byte-for-byte identical to
 *      block-math.ts), signs the result, and submits it to
 *      POST /api/consensus/submit-block.
 *   4. Vercel independently recomputes and verifies everything before
 *      accepting — a mismatch gets rejected and logged here, and the slot
 *      falls back to Vercel self-producing. Nothing this module does can
 *      get a bad block accepted; at worst it wastes a network round trip.
 *
 * Requires self-custody to already be set up (see east-self-custody.ts /
 * SelfCustodyMigrationSheet.tsx) — the vault password is asked once when
 * starting, and the decrypted mnemonic is kept in memory only for the
 * running session (never persisted, wiped on stop()).
 */

import { loadMnemonicFromVault, signWithMnemonic } from "@/lib/east-self-custody";
import { computeMerkleRoot, computeSequenceHash, computeBlockHash, buildProductionMessage } from "./block-math-browser";

const HEARTBEAT_INTERVAL_MS = 30_000; // must stay under the server's HEARTBEAT_FRESHNESS_SECONDS (90s)
const POLL_PROPOSAL_INTERVAL_MS = 2_000;
const MAX_LOG_ENTRIES = 30;

export type ProducerStatus = "idle" | "unlocking" | "running" | "error";

export type ProducerState = {
  status: ProducerStatus;
  telegramId: string | null;
  lastHeartbeatAt: number | null;
  lastError: string | null;
  blocksProduced: number;
  lastProducedBlockIndex: number | null;
  log: { time: number; message: string }[];
};

const initialState: ProducerState = {
  status: "idle",
  telegramId: null,
  lastHeartbeatAt: null,
  lastError: null,
  blocksProduced: 0,
  lastProducedBlockIndex: null,
  log: [],
};

class LightNodeProducer {
  private state: ProducerState = { ...initialState };
  private listeners = new Set<(s: ProducerState) => void>();
  private mnemonic: string | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private inFlightProduce = false;

  subscribe(fn: (s: ProducerState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => { this.listeners.delete(fn); };
  }

  private set(patch: Partial<ProducerState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(fn => fn(this.state));
  }

  private log(message: string) {
    const entry = { time: Date.now(), message };
    this.set({ log: [...this.state.log, entry].slice(-MAX_LOG_ENTRIES) });
  }

  get isRunning() {
    return this.state.status === "running";
  }

  /** Unlocks the local self-custody vault and starts the heartbeat + proposal-poll loops. */
  async start(telegramId: string, vaultPassword: string) {
    if (this.isRunning) return;
    this.set({ status: "unlocking", telegramId, lastError: null });

    try {
      this.mnemonic = await loadMnemonicFromVault(vaultPassword);
    } catch {
      this.set({ status: "error", lastError: "Wrong vault password, or no local self-custody vault found on this device." });
      return;
    }

    this.log("Producer mode started");
    this.set({ status: "running" });

    await this.sendHeartbeat(); // fire immediately, then on interval
    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), HEARTBEAT_INTERVAL_MS);
    this.pollTimer = setInterval(() => this.checkAndProduce(), POLL_PROPOSAL_INTERVAL_MS);
  }

  /** Stops both loops and wipes the mnemonic from memory. */
  stop() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.heartbeatTimer = null;
    this.pollTimer = null;
    this.mnemonic = null;
    this.log("Producer mode stopped");
    this.set({ status: "idle" });
  }

  private async sendHeartbeat() {
    if (!this.mnemonic || !this.state.telegramId) return;
    const telegramId = this.state.telegramId;
    const timestampMs = Date.now();
    const signature = signWithMnemonic(this.mnemonic, `HEARTBEAT|${telegramId}|${timestampMs}`);

    try {
      const res = await fetch("/api/node/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ telegramId, timestampMs, signature }),
      });
      if (res.ok) {
        this.set({ lastHeartbeatAt: Date.now() });
      } else {
        const body = await res.json().catch(() => ({}));
        this.log(`Heartbeat rejected: ${body.error || res.status}`);
        if (body.error === "SELF_CUSTODY_REQUIRED") {
          this.set({ status: "error", lastError: "Self-custody isn't registered on this account yet." });
          this.stop();
        }
      }
    } catch (err: any) {
      this.log(`Heartbeat error: ${err?.message || "network error"}`);
    }
  }

  private async checkAndProduce() {
    if (this.inFlightProduce || !this.mnemonic || !this.state.telegramId) return;
    const telegramId = this.state.telegramId;

    let proposal: any;
    try {
      const res = await fetch(`/api/consensus/my-proposal?telegramId=${encodeURIComponent(telegramId)}`);
      proposal = await res.json();
    } catch {
      return; // network hiccup — try again next poll, no need to log every miss
    }
    if (!proposal?.success || !proposal.pending) return; // not our turn — normal, stay quiet

    this.inFlightProduce = true;
    try {
      const { proposalId, blockIndex, prevHash, txHashes } = proposal;
      this.log(`Assigned leader for block #${blockIndex} (${txHashes.length} tx) — producing…`);

      const timestampMs = Date.now();
      const merkleRoot = await computeMerkleRoot(txHashes);
      const sequenceHash = await computeSequenceHash(prevHash, blockIndex, timestampMs);
      const blockHash = await computeBlockHash(prevHash, blockIndex, merkleRoot, timestampMs, txHashes.length);
      const signature = signWithMnemonic(this.mnemonic!, buildProductionMessage(proposalId, blockIndex, blockHash));

      const res = await fetch("/api/consensus/submit-block", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposalId, telegramId, prevHash, merkleRoot, sequenceHash, blockHash, timestampMs, signature }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.success) {
        this.log(`Block #${blockIndex} produced and accepted`);
        this.set({ blocksProduced: this.state.blocksProduced + 1, lastProducedBlockIndex: blockIndex });
      } else {
        this.log(`Block #${blockIndex} REJECTED by server: ${body.error || res.status}`);
      }
    } finally {
      this.inFlightProduce = false;
    }
  }
}

let instance: LightNodeProducer | null = null;

/** Singleton, same pattern as getLightNodeClient() in client.ts. */
export function getLightNodeProducer(): LightNodeProducer {
  if (!instance) instance = new LightNodeProducer();
  return instance;
}
