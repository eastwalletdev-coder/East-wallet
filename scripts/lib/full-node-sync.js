#!/usr/bin/env node
/**
 * EASTCHAIN — Validator Full-Node Sync
 * ─────────────────────────────────────────────────────────────────────
 * Gives a validator daemon two extra abilities on top of block
 * production (see block-producer-daemon.js, which requires() this):
 *
 *   1. Keeps a full LOCAL copy of the chain (header + transactions),
 *      not just the headers a Light Node verifies — see local-ledger.js.
 *   2. Joins the same Railway hub Light Nodes use, but over a plain
 *      WebSocket ("ws" package) instead of browser WebRTC — there's no
 *      RTCPeerConnection in Node, and a native binding (wrtc /
 *      node-datachannel) would need node-gyp, which is a common install
 *      failure on Termux/Android and bare VPS boxes. A WS connection
 *      relayed through Railway gets the same OUTCOME (peer-to-peer full
 *      sync instead of everyone hitting Vercel) without that risk.
 *
 * Trust model is identical to the Light Node: every block this module
 * receives — whether from another validator's full-sync response, or
 * from Vercel's /api/archive/blocks/{height}.json fallback — is verified
 * independently before being written to the local ledger (chain
 * continuity + secp256k1 signature, same check as lightnode/client.ts's
 * verifyHeader()). A peer serving fabricated history gets rejected block
 * by block; it can waste bandwidth, never inject a fake chain.
 *
 * Catch-up order for a gap: ask Railway who currently claims a full
 * ledger (`full_sync_providers`) → try requesting the range from one of
 * them over the relay → if none are available or the request times out,
 * fall back to pulling each missing height from Vercel directly. Once
 * caught up to the network tip, this node reports hasFullLedger:true so
 * it becomes one of those providers for the NEXT validator that joins.
 */

const WebSocket = require('ws');
const { verifyMessage } = require('ethers');
const { LocalLedger } = require('./local-ledger');

// Keep numerically in sync with EAST_CHAIN_ID in src/lib/contracts/registry.ts
// and railway-server/src/types.ts.
const EAST_CHAIN_ID = 172026;

const HELLO_TIMEOUT_MS = 10_000;
const FULL_SYNC_PEER_TIMEOUT_MS = 15_000; // give a peer this long to respond before falling back to Vercel
const CHUNK_SIZE = 25; // blocks per full_sync_response message — stays well under Railway's 64KB maxPayload
const RELAY_STATS_INTERVAL_MS = 30_000;
const DRIFT_RECHECK_INTERVAL_MS = 3 * 60_000; // re-confirm real height + re-run catch-up periodically, not just once at connect — see _startDriftRecheck() for why
const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;

function log(msg) {
  console.log(`[full-node-sync ${new Date().toISOString()}] ${msg}`);
}

function verifyChainSignature(trustedAddress, height, blockHash, signatureHex) {
  try {
    const message = `EASTCHAIN_BLOCK|${height}|${blockHash}`;
    const recovered = verifyMessage(message, signatureHex);
    return recovered.toLowerCase() === trustedAddress.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Verifies one block against the previous block this daemon already has
 * locally. Same rules as lightnode/client.ts's verifyHeader(): hash
 * continuity only enforced for the immediate next block (a gap isn't
 * evidence of tampering, it's expected when catching up), signature
 * mandatory from signingEnforcedFromHeight onward.
 */
function verifyBlock(block, prevBlock, chainSigningAddress, signingEnforcedFromHeight) {
  if (!block.hash || block.hash.length < 16) return { valid: false, reason: 'Invalid block hash' };
  if (prevBlock && block.height === prevBlock.height + 1 && block.previousHash !== prevBlock.hash) {
    return { valid: false, reason: 'Previous hash mismatch' };
  }

  const isPreSigningHistory = block.height < signingEnforcedFromHeight;
  if (!chainSigningAddress) {
    return { valid: false, reason: 'Chain signing address not configured — cannot verify' };
  }
  if (!block.signature) {
    if (isPreSigningHistory) return { valid: true, reason: 'Unsigned — pre-signing history' };
    return { valid: false, reason: 'Missing signature — mandatory at this height' };
  }
  if (!verifyChainSignature(chainSigningAddress, block.height, block.hash, block.signature)) {
    return { valid: false, reason: 'Invalid chain signature — possible tampering' };
  }
  return { valid: true, reason: 'Signature verified' };
}

class FullNodeSync {
  /**
   * @param {object} opts
   * @param {string} opts.railwayWsUrl
   * @param {string} opts.appUrl                     Vercel app base URL — fallback source for catch-up
   * @param {string} opts.chainSigningAddress         NEXT_PUBLIC_CHAIN_SIGNING_ADDRESS
   * @param {number} [opts.signingEnforcedFromHeight]  default 0
   * @param {string} [opts.nodeId]                     defaults to a random id, persisted isn't required
   */
  constructor(opts) {
    this.railwayWsUrl = opts.railwayWsUrl;
    this.appUrl = opts.appUrl.replace(/\/$/, '');
    this.chainSigningAddress = opts.chainSigningAddress;
    this.signingEnforcedFromHeight = opts.signingEnforcedFromHeight ?? 0;
    this.nodeId = opts.nodeId || `validator-${crypto_randomId()}`;

    this.ledger = new LocalLedger(opts.ledgerPath);
    this.ws = null;
    this.networkTipHeight = -1;
    this.fullSyncProviders = [];
    this.pendingPeerRequests = new Map(); // toNodeId -> { resolve, timer, blocks: [] }
    this.reconnectDelayMs = RECONNECT_BASE_MS;
    this.stopped = false;
    this._recheckInFlight = false;
  }

  start() {
    this.stopped = false;
    this._connect();
  }

  stop() {
    this.stopped = true;
    this.ws?.close();
  }

  _connect() {
    if (this.stopped) return;
    log(`Connecting to Railway hub (${this.railwayWsUrl})...`);
    const ws = new WebSocket(this.railwayWsUrl);
    this.ws = ws;

    ws.on('open', () => {
      this.reconnectDelayMs = RECONNECT_BASE_MS;
      ws.send(JSON.stringify({ type: 'hello', role: 'light-node', nodeId: this.nodeId, chainId: EAST_CHAIN_ID }));
      this._relayStatsTimer = setInterval(() => this._reportStats(), RELAY_STATS_INTERVAL_MS);
      this._driftRecheckTimer = setInterval(() => this._recheckDrift(), DRIFT_RECHECK_INTERVAL_MS);
    });

    ws.on('message', (raw) => this._handleMessage(raw));

    ws.on('close', () => {
      log('Disconnected from Railway hub.');
      clearInterval(this._relayStatsTimer);
      clearInterval(this._driftRecheckTimer);
      if (this.stopped) return;
      const delay = this.reconnectDelayMs;
      log(`Reconnecting in ${Math.round(delay / 1000)}s...`);
      setTimeout(() => this._connect(), delay);
      this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, RECONNECT_MAX_MS);
    });

    ws.on('error', (err) => log(`WebSocket error: ${err.message}`));
  }

  async _handleMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    switch (msg.type) {
      case 'welcome':
        // Railway's own latestHeight is NOT trustworthy here — it's only
        // whatever block:new broadcasts Railway itself has seen since ITS
        // last restart, not the real chain height. If Railway just
        // restarted (or nothing's been sealed since), it reports -1 even
        // when the real chain is at block #800+. Ask Vercel directly for
        // the authoritative number instead of catching up to Railway's
        // possibly-wrong idea of the tip.
        this.networkTipHeight = msg.latestHeight ?? -1;
        log(`Connected. Railway's own tip: #${this.networkTipHeight}. Local tip: #${this.ledger.getLatestHeight()}. Confirming real height with Vercel...`);
        await this._refreshRealNetworkTip();
        this._catchUp();
        break;

      case 'full_sync_providers':
        this.fullSyncProviders = (msg.nodeIds || []).filter((id) => id !== this.nodeId);
        break;

      case 'block:new':
        this._onNewHeader(msg.header);
        break;

      case 'full_sync_request':
        this._serveFullSyncRequest(msg);
        break;

      case 'full_sync_response':
        this._receiveFullSyncChunk(msg);
        break;

      case 'error':
        log(`Hub error: ${msg.message}`);
        break;
    }
  }

  _reportStats() {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({
      type: 'relay_stats',
      nodeId: this.nodeId,
      avgLatencyMs: 50, // not measured here — this daemon isn't competing for the relay roster, only the full-sync provider list
      participationSeconds: Math.floor(process.uptime()),
      verifiedHeaderCount: this.ledger.size,
      hasFullLedger: this.networkTipHeight >= 0 && this.ledger.getLatestHeight() >= this.networkTipHeight,
    }));
  }

  async _refreshRealNetworkTip() {
    try {
      const res = await fetch(`${this.appUrl}/api/chain-height`);
      if (!res.ok) { log(`  Vercel height check failed (${res.status}) — keeping Railway's figure.`); return; }
      const data = await res.json();
      if (typeof data.latestHeight === 'number' && data.latestHeight > this.networkTipHeight) {
        log(`  Vercel says real tip is #${data.latestHeight} (Railway said #${this.networkTipHeight}) — using Vercel's number.`);
        this.networkTipHeight = data.latestHeight;
      }
    } catch (err) {
      log(`  Vercel height check failed (${err.message}) — keeping Railway's figure.`);
    }
  }

  // ── Catch-up ──────────────────────────────────────────────────────
  // _catchUp() at connect time only covers the gap accumulated up to
  // that moment — after that, this node's local ledger relies entirely
  // on live block:new broadcasts to stay current (see _onNewHeader
  // below). If even one broadcast never arrives (Railway cold-start
  // right when Vercel's fire-and-forget publishBlockToRailway() call
  // fires, a dropped WS frame, etc.) there was previously NO mechanism
  // to notice — the local ledger would silently fall behind forever,
  // even while hasFullLedger:true kept being reported. _recheckDrift()
  // re-confirms the real tip with Vercel and re-runs catch-up on a
  // timer so a missed broadcast self-heals within one interval instead
  // of requiring a manual restart.
  async _recheckDrift() {
    if (this._recheckInFlight) return; // don't overlap if a previous recheck is still catching up a large gap
    this._recheckInFlight = true;
    try {
      await this._refreshRealNetworkTip();
      const gap = this.networkTipHeight - this.ledger.getLatestHeight();
      if (gap > 0) {
        log(`Drift recheck: local tip is ${gap} block(s) behind #${this.networkTipHeight} — a block:new broadcast was likely missed. Catching up.`);
        await this._catchUp();
      }
    } finally {
      this._recheckInFlight = false;
    }
  }

  async _catchUp() {
    const from = this.ledger.getLatestHeight() + 1;
    const to = this.networkTipHeight;
    if (to < 0 || from > to) {
      log('Already caught up.');
      this._reportStats();
      return;
    }
    log(`Catching up blocks #${from}–#${to} (${to - from + 1} block(s))...`);

    const gotFromPeer = await this._tryPeerCatchUp(from, to);
    const stillMissing = [];
    for (let h = from; h <= to; h++) if (!this.ledger.hasBlock(h)) stillMissing.push(h);

    if (stillMissing.length > 0) {
      log(`${stillMissing.length} block(s) not available from a peer — falling back to Vercel.`);
      await this._catchUpFromVercel(stillMissing);
    }

    const finalMissing = [];
    for (let h = from; h <= to; h++) if (!this.ledger.hasBlock(h)) finalMissing.push(h);
    if (finalMissing.length > 0) {
      log(`WARNING: still missing ${finalMissing.length} block(s) after catch-up: [${finalMissing.slice(0, 10).join(', ')}${finalMissing.length > 10 ? '...' : ''}]`);
    } else {
      log(`Caught up to #${to}.`);
    }
    this._reportStats();
  }

  async _tryPeerCatchUp(from, to) {
    if (this.fullSyncProviders.length === 0) return false;
    const peer = this.fullSyncProviders[Math.floor(Math.random() * this.fullSyncProviders.length)];
    log(`Requesting #${from}–#${to} from peer ${peer}...`);

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingPeerRequests.delete(peer);
        log(`Peer ${peer} timed out.`);
        resolve(false);
      }, FULL_SYNC_PEER_TIMEOUT_MS);

      this.pendingPeerRequests.set(peer, {
        timer,
        onComplete: () => { clearTimeout(timer); resolve(true); },
      });

      this.ws.send(JSON.stringify({ type: 'full_sync_request', toNodeId: peer, fromHeight: from, toHeight: to }));
    });
  }

  // Uses /api/archive/blocks-range so this whole gap costs a couple of
  // Postgres queries total instead of 2 queries PER HEIGHT — see that
  // route's doc comment for the before/after. Chunked at the server's own
  // MAX_RANGE (500) so one oversized gap can't blow past its cap.
  async _catchUpFromVercel(heights) {
    if (heights.length === 0) return;
    const RANGE_CHUNK = 500;
    const sorted = [...heights].sort((a, b) => a - b);
    const from = sorted[0];
    const to = sorted[sorted.length - 1];

    for (let chunkFrom = from; chunkFrom <= to; chunkFrom += RANGE_CHUNK) {
      const chunkTo = Math.min(chunkFrom + RANGE_CHUNK - 1, to);
      let blocks = [];
      try {
        const res = await fetch(`${this.appUrl}/api/archive/blocks-range?from=${chunkFrom}&to=${chunkTo}`);
        if (!res.ok) { log(`  #${chunkFrom}-${chunkTo}: ${res.status} from Vercel — skipping`); continue; }
        const body = await res.json();
        if (!body.success || !Array.isArray(body.blocks)) continue;
        blocks = body.blocks;
      } catch (err) {
        log(`  #${chunkFrom}-${chunkTo}: fetch failed (${err.message})`);
        continue;
      }
      const byHeight = new Map(blocks.map(b => [b.height, b]));
      for (const h of sorted.filter(x => x >= chunkFrom && x <= chunkTo)) {
        const block = byHeight.get(h);
        if (!block) { log(`  #${h}: not in archive response — skipping`); continue; }
        this._verifyAndStore(block);
      }
    }
  }

  _verifyAndStore(block) {
    const prev = this.ledger.getBlock(block.height - 1);
    const result = verifyBlock(block, prev, this.chainSigningAddress, this.signingEnforcedFromHeight);
    if (!result.valid) {
      log(`  #${block.height}: REJECTED — ${result.reason}`);
      return false;
    }
    this.ledger.appendBlock(block);
    return true;
  }

  _onNewHeader(header) {
    if (this.ledger.hasBlock(header.height)) return;
    this.networkTipHeight = Math.max(this.networkTipHeight, header.height);
    // block:new only carries the header (Railway never sends tx bodies over
    // the broadcast channel) — pull the full block+tx data for just this
    // one fresh height. Cheap: it's a single recent block, not a backfill.
    this._catchUpFromVercel([header.height]).then(() => this._reportStats());
  }

  // ── Serving other nodes ─────────────────────────────────────────────
  _serveFullSyncRequest(msg) {
    const { fromNodeId, fromHeight, toHeight } = msg;
    if (!fromNodeId) return;
    const blocks = this.ledger.getRange(fromHeight, toHeight);
    log(`Serving #${fromHeight}–#${toHeight} to ${fromNodeId} (${blocks.length} block(s) available).`);
    for (let i = 0; i < blocks.length; i += CHUNK_SIZE) {
      const chunk = blocks.slice(i, i + CHUNK_SIZE);
      this.ws.send(JSON.stringify({ type: 'full_sync_response', toNodeId: fromNodeId, blocks: chunk }));
    }
  }

  _receiveFullSyncChunk(msg) {
    const { fromNodeId, blocks } = msg;
    let accepted = 0;
    for (const block of blocks || []) {
      if (this._verifyAndStore(block)) accepted++;
    }
    log(`Received ${blocks?.length ?? 0} block(s) from ${fromNodeId}, ${accepted} verified and stored.`);

    const pending = this.pendingPeerRequests.get(fromNodeId);
    if (pending && this.ledger.getLatestHeight() >= this.networkTipHeight) {
      this.pendingPeerRequests.delete(fromNodeId);
      pending.onComplete();
    }
  }
}

function crypto_randomId() {
  return require('crypto').randomBytes(6).toString('hex');
}

module.exports = { FullNodeSync };
