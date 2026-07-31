"use client"

// ─── EAST Light Node — WebRTC peer mesh ────────────────────────────────
// Optional bandwidth/resilience layer on top of the Railway hub, not a
// replacement for it. Railway is still the only way to ESTABLISH a new
// connection (it relays offer/answer/ICE blind, see railway-server's
// webrtc_offer/webrtc_answer/ice_candidate handlers) — but peers can now
// LEARN about each other beyond just Railway's own tier assignment via
// Peer Exchange (requestPeerList()/knownPeerIds below): once connected,
// a node periodically asks its peers who ELSE they're connected to. That
// alone doesn't establish anything — knowing a nodeId with no signaling
// path to it is just a hint — but it means an already-connected mesh
// keeps functioning and knows it's bigger than its own direct links even
// if Railway goes down entirely (see client.ts's ws.onclose, which no
// longer tears the mesh down). Actually connecting to a knownPeers entry
// without going through Railway is now possible too — see the
// PEER-RELAYED SIGNALING section below.
//
// SECURITY INVARIANT: a header arriving over a peer DataChannel goes
// through the exact same verifyHeader() check in client.ts as one that
// arrived from Railway directly. This file never marks anything as
// "verified" — it only moves bytes. A malicious or broken peer can waste
// your bandwidth with garbage; it cannot get a bad header accepted. This
// applies just as much to range_response blocks as to live header gossip
// — client.ts runs every block returned here through applyHeader() same
// as anything else. Peer Exchange carries the same spirit: a lying peer
// can at worst hand you a list of made-up/stale nodeIds (capped and
// TTL'd — see MAX_KNOWN_PEERS/KNOWN_PEER_TTL_MS), never anything that
// gets treated as verified data.
//
// PEER-RELAYED SIGNALING: the "next step" flagged above is now built. A
// knownPeers entry already tells us WHO vouched for a nodeId (viaPeerId) —
// that voucher is, by construction, someone we're directly connected to
// AND who is directly connected to the target. So instead of needing
// Railway to carry offer/answer/ICE for a brand-new pair, we can ask that
// voucher to carry it one hop over the DataChannel it already has open to
// both sides ("signal_relay" message kind, below). Railway is still used
// whenever it's available (it's simpler and doesn't cost a connected
// peer's bandwidth) — the relay path only gets used as a fallback, and
// only ever ONE hop (MAX_RELAY_HOPS) to keep it from turning into a flood
// or a loop. Trust model is unchanged: a relay only ever moves opaque
// SDP/ICE bytes blind, exactly like Railway does — it can't inspect or
// tamper with what's inside any more than Railway could, and the eventual
// header stream over the resulting DataChannel still goes through
// verifyHeader() same as always.
//
// STUN by default. TURN is now supported but OPT-IN and fetched at runtime
// (see client.ts's fetchIceServers(), which calls GET /api/turn-credentials)
// rather than hardcoded here — a TURN server needs real relay bandwidth
// budgeted for it and short-lived credentials rather than a secret baked
// into the client bundle, so it's provisioned per-deployment, not by
// default. With no TURN configured, behavior is unchanged from before:
// peer pairs that need a relay to cross NAT (symmetric NAT on both sides)
// just can't establish, and silently fall back to Railway's own header
// stream — never worse than that.
import { getRange } from "./block-store";

const STUN_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

const DATACHANNEL_LABEL = "headers";

// Hard cap on simultaneous WebRTC peer connections per node. Without this,
// Railway's existing top-N relay promotion (RELAY_ROSTER_SIZE=5 in
// railway-server) means EVERY connected lightnode dials ALL 5 relay nodes
// directly — at real scale (MAX_LIGHT_NODES=5000) that's up to 5000 direct
// connections landing on just 5 sockets, nowhere near the ~20-30 a single
// browser tab can hold up reliably. Capping here bounds it: once at the
// cap, connectTo() and handleOffer() both decline further connections —
// callers fall back to Railway directly for that pair, same graceful
// degradation as a failed NAT traversal (see file header). True multi-tier
// fan-out (relay → tier-2 → tier-3, so load actually spreads instead of
// just being refused past the cap) is a bigger change for later; this cap
// is the safety net in the meantime.
const MAX_MESH_PEERS = 20;

// ICE restart on IP change (WiFi<->cellular switch, NAT rebinding, etc.):
// "disconnected" is often transient — WebRTC's own keepalives can recover
// it within a couple seconds without any help. Give it this grace window
// before doing anything, so a normal brief blip never triggers a restart.
// "failed" means ICE has already given up trying by itself — no need to
// wait there, restart immediately.
const ICE_DISCONNECT_GRACE_MS = 4_000;
// After sending an ICE-restart offer, how long to wait for it to actually
// land (answer comes back, state flips to "connected") before giving up
// and treating the peer as genuinely gone rather than just IP-shuffled.
const ICE_RESTART_FAILSAFE_MS = 10_000;

export interface PeerMeshCallbacks {
  /** Send a signaling message out over the existing Railway WS connection. */
  sendSignal: (msg: { type: "webrtc_offer" | "webrtc_answer" | "ice_candidate"; toNodeId: string; sdp?: string; candidate?: string }) => void;
  /** A header arrived from a peer — hand it to the SAME verifyHeader() path as Railway-sourced headers. */
  onPeerHeader: (peerNodeId: string, header: unknown) => void;
  onPeerConnected?: (peerNodeId: string) => void;
  onPeerDisconnected?: (peerNodeId: string) => void;
  /** Connection dropped (IP change, NAT rebind, etc.) and we're attempting an ICE restart to resume the SAME session rather than tearing it down. */
  onPeerReconnecting?: (peerNodeId: string) => void;
  /** ICE restart succeeded — connection is back without ever having been torn down or re-dialed from scratch. */
  onPeerRecovered?: (peerNodeId: string) => void;
}

interface Peer {
  connection: RTCPeerConnection;
  channel: RTCDataChannel | null;
  // Whether the active candidate pair for this connection is relayed via a
  // TURN server (as opposed to a direct/STUN-reflexive path). null until
  // detectRelayUsage() resolves shortly after the DataChannel opens — see
  // wireChannel()'s onopen handler. Only meaningful once true/false.
  usingTurn: boolean | null;
  // Peer-to-peer latency/heartbeat over the DataChannel itself — separate
  // from (and doesn't depend on) the client<->hub WS latency/heartbeat.
  // latencyMs is round-trip time from the last ping/pong exchange;
  // lastSeenAt updates on ANY message from this peer (not just pong), so
  // it stays fresh even between ping cycles.
  latencyMs: number | null;
  lastSeenAt: number;
  pingSentAt: number;
  pingTimer: ReturnType<typeof setInterval> | null;
}

interface PendingRangeRequest {
  received: Map<number, any>; // height -> block, deduped across however many peers answer
  timer: ReturnType<typeof setTimeout>;
  resolve: (blocks: any[]) => void;
}

interface KnownPeer {
  nodeId: string;
  viaPeerId: string; // who told us about them — never a signaling path by itself, see requestPeerList()
  lastSeenAt: number;
}

// Caps how many entries a single peer_list_response can add, and how large
// the whole known-peers directory can grow. Without these, a malicious or
// just-buggy peer could hand back thousands of fabricated nodeIds and
// slowly bloat memory — this is a discovery HINT list, not a trust
// boundary, so it costs nothing to just clip it rather than validate every
// entry deeply.
const MAX_PEER_LIST_ENTRIES_PER_RESPONSE = 50;
const MAX_KNOWN_PEERS = 200;
const KNOWN_PEER_TTL_MS = 10 * 60_000; // stale entries (peer probably long gone) get pruned on the next PEX round rather than lingering forever

// A signal_relay message is only ever forwarded ONCE by whoever receives it
// mid-flight (hops goes 0 -> 1, then it must be addressed to the receiver or
// it's dropped). This is what keeps relaying to exactly the "voucher already
// connected to both sides" case it's meant for, instead of letting a message
// wander the mesh hop by hop.
const MAX_RELAY_HOPS = 1;

// How often each peer connection pings the other over the DataChannel to
// measure round-trip latency and confirm it's still alive. Independent of
// (and much more frequent than makes sense for) the client<->hub WS
// heartbeat — this is measuring the P2P path specifically.
const PEER_PING_INTERVAL_MS = 15_000;

// How often we probe a TURN-relayed peer to see if a direct/STUN path has
// become viable since — NAT mappings can change (new wifi, router
// restart), so it's worth periodically re-checking. 5 minutes balances
// "catch it reasonably soon after conditions improve" against "don't
// waste cycles re-probing pairs that will never go direct" (e.g.
// symmetric-NAT-to-symmetric-NAT, which no amount of retrying fixes).
const TURN_UPGRADE_CHECK_INTERVAL_MS = 5 * 60_000;
// How long to wait after triggering an ICE restart before re-checking
// which candidate pair won — renegotiation + new candidate gathering
// needs a moment to settle.
const TURN_UPGRADE_CHECK_DELAY_MS = 4_000;

export class PeerMesh {
  private selfNodeId: string;
  private peers = new Map<string, Peer>();
  private callbacks: PeerMeshCallbacks;
  private turnUpgradeTimer: ReturnType<typeof setInterval> | null = null;
  private pendingRangeRequests = new Map<string, PendingRangeRequest>();
  // targetNodeId -> relay peer nodeId. Set whenever we establish (or receive)
  // a connection attempt through a relay rather than Railway, so every
  // signal for that target (offer -> answer -> the ICE trickle after it)
  // keeps using the same one-hop path instead of falling back to Railway
  // mid-handshake. Cleared once the direct DataChannel to that target opens.
  private relayViaPeer = new Map<string, string>();
  // ICE-restart bookkeeping (IP change recovery — see ICE_DISCONNECT_GRACE_MS
  // above). disconnectGraceTimers: waiting out a possibly-transient
  // "disconnected" before trying anything. restartFailsafeTimers: an ICE
  // restart offer went out, waiting to see if it actually lands before
  // giving up for real. A peerNodeId is in at most one of these at a time.
  private disconnectGraceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private restartFailsafeTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // Starts STUN-only; setTurnServers() appends TURN entries once client.ts's
  // fetchIceServers() resolves (or on its periodic refresh before the
  // minted credential's TTL runs out). Any RTCPeerConnection created via
  // createConnection() picks up whatever's current at that moment — an
  // in-flight connection isn't retroactively updated, but that's fine:
  // TURN candidates only matter during ICE gathering at connection setup,
  // never mid-session.
  private iceServers: RTCIceServer[] = [...STUN_SERVERS];
  // Peer Exchange (PEX) directory — nodeIds we've heard about from a
  // connected peer but aren't (yet) directly connected to ourselves. This
  // is deliberately just a hint list for now: without a signaling path to
  // an unconnected nodeId, knowing it exists doesn't let us reach it. What
  // it DOES give us today: visibility into how much bigger the mesh is
  // than our own direct connections, and groundwork for peer-relayed
  // signaling later (a connected peer vouching for/relaying to someone in
  // its own list) without needing another protocol change to add that.
  private knownPeers = new Map<string, KnownPeer>();

  constructor(selfNodeId: string, callbacks: PeerMeshCallbacks) {
    this.selfNodeId = selfNodeId;
    this.callbacks = callbacks;
    this.turnUpgradeTimer = setInterval(() => this.probeTurnUpgrades(), TURN_UPGRADE_CHECK_INTERVAL_MS);
  }

  get connectedPeerIds(): string[] {
    return [...this.peers.entries()]
      .filter(([, p]) => p.channel?.readyState === "open")
      .map(([id]) => id);
  }

  /** How many currently-connected peers are relaying through a TURN server
   *  rather than connected directly (STUN/host candidates). Peers whose
   *  candidate-pair check hasn't resolved yet (usingTurn still null) are
   *  not counted either way — see detectRelayUsage(). */
  get turnPeerCount(): number {
    return [...this.peers.entries()]
      .filter(([, p]) => p.channel?.readyState === "open" && p.usingTurn === true)
      .length;
  }

  /** Everyone we've learned about via Peer Exchange, whether or not we're
   *  directly connected to them ourselves — see the knownPeers field comment. */
  get knownPeerIds(): string[] {
    return [...this.knownPeers.keys()];
  }

  /** Same as knownPeerIds but with the voucher attached — the voucher is who
   *  to ask for a relay if we want to reach this nodeId without Railway. */
  get knownPeerEntries(): { nodeId: string; viaPeerId: string }[] {
    return [...this.knownPeers.values()].map(({ nodeId, viaPeerId }) => ({ nodeId, viaPeerId }));
  }

  /** Hydrates knownPeers from a cross-restart cache (see client.ts's
   *  PEER_CACHE_STORAGE_KEY) so mesh-expansion has candidates to try
   *  immediately on a fresh app launch, instead of only whatever this
   *  session's live PEX has surfaced so far. The viaPeerId in a persisted
   *  entry is almost certainly stale (that voucher probably isn't even
   *  connected in THIS session) — that's fine and not dangerous: emitSignal
   *  already falls back to Railway whenever the relay channel isn't open,
   *  so a dead viaPeerId just means "try Railway instead", same as having
   *  no hint at all. lastSeenAt is reset to now rather than trusting the
   *  persisted timestamp, so a rehydrated entry gets a full fresh TTL
   *  window instead of being pruned on the very next PEX cycle. */
  seedKnownPeers(entries: { nodeId: string; viaPeerId: string }[]) {
    const now = Date.now();
    for (const { nodeId, viaPeerId } of entries) {
      if (this.knownPeers.size >= MAX_KNOWN_PEERS) break;
      if (nodeId === this.selfNodeId) continue;
      if (this.knownPeers.has(nodeId)) continue; // live PEX data (if any exists already) wins over a rehydrated guess
      this.knownPeers.set(nodeId, { nodeId, viaPeerId, lastSeenAt: now });
    }
  }

  // Asks every currently-connected peer "who else are you connected to?"
  // and merges the answers into knownPeers. This is what lets the mesh's
  // reachable footprint grow past Railway's own tier assignment (a
  // node only ever gets told about its ONE parent) purely by peers
  // vouching for each other — no signaling capacity used, since it never
  // tries to CONNECT to anyone new by itself (see the knownPeers field
  // comment on why that's a separate, later step). Safe to call with zero
  // connected peers — just does nothing.
  requestPeerList() {
    const msg = JSON.stringify({ kind: "peer_list_request" });
    this.peers.forEach((peer) => {
      if (peer.channel?.readyState === "open") peer.channel.send(msg);
    });
  }

  /** Initiate a connection to a promoted relay node (we are the offerer).
   *  Pass viaPeerId (typically a knownPeers voucher) to carry the signaling
   *  one hop through that peer's DataChannel instead of Railway — use this
   *  when Railway is unreachable. Leave it undefined for the normal path. */
  async connectTo(peerNodeId: string, viaPeerId?: string) {
    if (this.peers.has(peerNodeId)) return; // already connecting/connected
    if (this.peers.size >= MAX_MESH_PEERS) return; // at cap — this pair falls back to Railway directly instead
    if (viaPeerId) this.relayViaPeer.set(peerNodeId, viaPeerId);
    const pc = this.createConnection(peerNodeId);
    const channel = pc.createDataChannel(DATACHANNEL_LABEL);
    this.wireChannel(peerNodeId, channel);
    this.peers.set(peerNodeId, { connection: pc, channel, usingTurn: null, latencyMs: null, lastSeenAt: Date.now(), pingSentAt: 0, pingTimer: null });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.emitSignal(peerNodeId, { type: "webrtc_offer", sdp: offer.sdp });
  }

  /** Someone offered us a connection (we are the answerer). viaPeerId is set
   *  when the offer itself arrived relayed through a peer rather than
   *  Railway — see handleSignalRelay — so the answer/ICE going back use the
   *  same one-hop path. */
  async handleOffer(fromNodeId: string, sdp: string, viaPeerId?: string) {
    const existing = this.peers.get(fromNodeId);
    if (existing?.channel?.readyState === "open") {
      // RENEGOTIATION: an offer arriving for a peer whose DataChannel is
      // already open is (in practice) the other side's own ICE restart —
      // see attemptIceRestart() above, same mechanism, just triggered by
      // THEIR network change instead of ours. Answer on the SAME
      // RTCPeerConnection/DataChannel; tearing anything down here would
      // drop a channel that's still perfectly usable just to rebuild an
      // identical one.
      if (viaPeerId) this.relayViaPeer.set(fromNodeId, viaPeerId);
      await existing.connection.setRemoteDescription({ type: "offer", sdp });
      const answer = await existing.connection.createAnswer();
      await existing.connection.setLocalDescription(answer);
      this.emitSignal(fromNodeId, { type: "webrtc_answer", sdp: answer.sdp });
      return;
    }
    if (existing) {
      // GLARE: we already have an entry for this peer, meaning WE also
      // called connectTo() on them around the same time (mutual dial —
      // both sides picked each other via bootstrap/PEX/tier assignment
      // close enough in time that neither had heard back yet). Without
      // this branch, we'd create a SECOND RTCPeerConnection right below
      // and overwrite the map entry, orphaning the first pc (never
      // closed — leaks) while its already-sent offer/ICE candidates end
      // up aimed at a connection that no longer exists on our side. The
      // channel then never opens on either end and the peer looks
      // "connecting" forever.
      //
      // Resolve deterministically so exactly one attempt survives on
      // BOTH sides: compare nodeIds. The lexicographically smaller one
      // is "impolite" — it keeps its own outgoing offer in flight and
      // ignores this incoming one. The other side is "polite" — it
      // abandons its own half-open attempt and answers this offer
      // instead. Both sides run the same comparison, so both always
      // agree on who's who; no coordination message needed.
      const weAreImpolite = this.selfNodeId < fromNodeId;
      if (weAreImpolite) return; // ignore — they'll be polite and answer our offer instead
      existing.connection.close();
      this.peers.delete(fromNodeId);
    } else if (this.peers.size >= MAX_MESH_PEERS) {
      return; // at cap — decline, offerer falls back to Railway
    }
    if (viaPeerId) this.relayViaPeer.set(fromNodeId, viaPeerId);
    const pc = this.createConnection(fromNodeId);
    pc.ondatachannel = (ev) => this.wireChannel(fromNodeId, ev.channel);
    this.peers.set(fromNodeId, { connection: pc, channel: null, usingTurn: null, latencyMs: null, lastSeenAt: Date.now(), pingSentAt: 0, pingTimer: null });

    await pc.setRemoteDescription({ type: "offer", sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.emitSignal(fromNodeId, { type: "webrtc_answer", sdp: answer.sdp });
  }

  async handleAnswer(fromNodeId: string, sdp: string) {
    const peer = this.peers.get(fromNodeId);
    if (!peer) return; // stale/unsolicited answer — ignore rather than throw
    await peer.connection.setRemoteDescription({ type: "answer", sdp });
  }

  async handleIceCandidate(fromNodeId: string, candidate: string) {
    const peer = this.peers.get(fromNodeId);
    if (!peer) return;
    try {
      await peer.connection.addIceCandidate(JSON.parse(candidate));
    } catch {
      // Late/duplicate candidate after connection already settled — harmless.
    }
  }

  /** Push our latest known header(s) out to every connected peer (best-effort gossip). excludePeerId skips echoing a header back to whoever we just received it from — used when forwarding a peer-sourced header onward down the tree. */
  broadcastHeader(header: unknown, excludePeerId?: string) {
    const msg = JSON.stringify({ kind: "header", header });
    this.peers.forEach((peer, peerId) => {
      if (peerId === excludePeerId) return;
      if (peer.channel?.readyState === "open") peer.channel.send(msg);
    });
  }

  // Asks every connected peer "does anyone have #fromHeight-#toHeight",
  // merges whatever range_response messages come back (deduped by height,
  // across however many peers answer) within timeoutMs, then resolves.
  // Best-effort by nature: no connected peers, or none of them having the
  // range, both just resolve to an empty array — callers (client.ts) fall
  // through to a validator/archive from there, same as if this didn't
  // exist. This never rejects.
  requestRange(fromHeight: number, toHeight: number, timeoutMs: number): Promise<any[]> {
    const openPeers = [...this.peers.values()].filter((p) => p.channel?.readyState === "open");
    if (openPeers.length === 0) return Promise.resolve([]);

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const msg = JSON.stringify({ kind: "range_request", requestId, fromHeight, toHeight });

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const pending = this.pendingRangeRequests.get(requestId);
        this.pendingRangeRequests.delete(requestId);
        resolve(pending ? [...pending.received.values()].sort((a, b) => a.height - b.height) : []);
      }, timeoutMs);

      this.pendingRangeRequests.set(requestId, { received: new Map(), timer, resolve });
      openPeers.forEach((peer) => peer.channel!.send(msg));
    });
  }

  disconnect(peerNodeId: string) {
    const peer = this.peers.get(peerNodeId);
    if (!peer) return;
    this.clearRecoveryTimers(peerNodeId);
    if (peer.pingTimer) clearInterval(peer.pingTimer);
    peer.channel?.close();
    peer.connection.close();
    this.peers.delete(peerNodeId);
    // Anyone we were routing signals through this (now-gone) peer for has
    // lost their relay path — drop those entries too so emitSignal falls
    // back to Railway on the next attempt instead of quietly aiming at a
    // dead relay every time.
    for (const [target, via] of this.relayViaPeer) {
      if (via === peerNodeId) this.relayViaPeer.delete(target);
    }
  }

  disconnectAll() {
    if (this.turnUpgradeTimer) clearInterval(this.turnUpgradeTimer);
    this.turnUpgradeTimer = null;
    [...this.peers.keys()].forEach((id) => this.disconnect(id));
  }

  /** Adds TURN server(s) on top of the default STUN list — call once
   *  fetchIceServers() resolves a configured TURN response, and again
   *  whenever it refreshes with a new short-lived credential. Replaces any
   *  previously-set TURN entries rather than accumulating them (each call
   *  represents "these are the current valid credentials," not an addition
   *  to a growing list). */
  setTurnServers(turnServers: RTCIceServer[]) {
    this.iceServers = [...STUN_SERVERS, ...turnServers];
  }

  private createConnection(peerNodeId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        this.emitSignal(peerNodeId, { type: "ice_candidate", candidate: JSON.stringify(ev.candidate) });
      }
    };
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === "connected") {
        const wasRecovering = this.disconnectGraceTimers.has(peerNodeId) || this.restartFailsafeTimers.has(peerNodeId);
        this.clearRecoveryTimers(peerNodeId);
        if (wasRecovering) this.callbacks.onPeerRecovered?.(peerNodeId);
      } else if (state === "disconnected") {
        // Don't stack a second grace timer if one's already ticking (or an
        // ICE restart is already in flight) for this peer.
        if (this.disconnectGraceTimers.has(peerNodeId) || this.restartFailsafeTimers.has(peerNodeId)) return;
        const timer = setTimeout(() => {
          this.disconnectGraceTimers.delete(peerNodeId);
          if (pc.connectionState === "disconnected") this.attemptIceRestart(peerNodeId, pc);
        }, ICE_DISCONNECT_GRACE_MS);
        this.disconnectGraceTimers.set(peerNodeId, timer);
      } else if (state === "failed") {
        const graceTimer = this.disconnectGraceTimers.get(peerNodeId);
        if (graceTimer) { clearTimeout(graceTimer); this.disconnectGraceTimers.delete(peerNodeId); }
        if (!this.restartFailsafeTimers.has(peerNodeId)) this.attemptIceRestart(peerNodeId, pc);
      } else if (state === "closed") {
        this.clearRecoveryTimers(peerNodeId);
        this.disconnect(peerNodeId);
        this.callbacks.onPeerDisconnected?.(peerNodeId);
      }
    };
    return pc;
  }

  // Tries to resume the SAME RTCPeerConnection/DataChannel via ICE restart
  // (fresh candidate gathering under a renegotiated SDP) instead of
  // tearing the connection down and forcing a full re-dial from scratch —
  // the fast path for the common case of an IP change (WiFi<->cellular,
  // NAT rebind) rather than the peer actually being gone. If this doesn't
  // land within ICE_RESTART_FAILSAFE_MS (peer genuinely offline, or it
  // doesn't support/handle the restart), falls through to a real
  // disconnect — never worse than today's immediate-teardown behavior,
  // just gives recovery a chance first.
  private async attemptIceRestart(peerNodeId: string, pc: RTCPeerConnection) {
    const peer = this.peers.get(peerNodeId);
    if (!peer || peer.connection !== pc) return; // stale timer firing for a pc that's since been replaced/removed
    this.callbacks.onPeerReconnecting?.(peerNodeId);
    try {
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      this.emitSignal(peerNodeId, { type: "webrtc_offer", sdp: offer.sdp! });
    } catch {
      this.restartFailsafeTimers.delete(peerNodeId);
      this.disconnect(peerNodeId);
      this.callbacks.onPeerDisconnected?.(peerNodeId);
      return;
    }
    const failsafe = setTimeout(() => {
      this.restartFailsafeTimers.delete(peerNodeId);
      if (pc.connectionState !== "connected") {
        this.disconnect(peerNodeId);
        this.callbacks.onPeerDisconnected?.(peerNodeId);
      }
    }, ICE_RESTART_FAILSAFE_MS);
    this.restartFailsafeTimers.set(peerNodeId, failsafe);
  }

  private clearRecoveryTimers(peerNodeId: string) {
    const grace = this.disconnectGraceTimers.get(peerNodeId);
    if (grace) { clearTimeout(grace); this.disconnectGraceTimers.delete(peerNodeId); }
    const failsafe = this.restartFailsafeTimers.get(peerNodeId);
    if (failsafe) { clearTimeout(failsafe); this.restartFailsafeTimers.delete(peerNodeId); }
  }

  // Fires every TURN_UPGRADE_CHECK_INTERVAL_MS for every currently-TURN-
  // relayed peer, trying to find out whether a direct/STUN path has become
  // viable since the last check (NAT mappings do change over time). Kept
  // completely separate from attemptIceRestart(): that one is recovering a
  // BROKEN connection and gives up (disconnects) if the fix doesn't land.
  // This one probes an ALREADY WORKING TURN connection purely to see if it
  // can be made cheaper/faster — it must never be the reason a working
  // connection gets torn down, so there is no failsafe-disconnect here.
  private probeTurnUpgrades() {
    for (const [peerNodeId, peer] of this.peers) {
      if (peer.usingTurn === true && peer.connection.connectionState === "connected") {
        this.attemptTurnUpgrade(peerNodeId);
      }
    }
  }

  private async attemptTurnUpgrade(peerNodeId: string) {
    const peer = this.peers.get(peerNodeId);
    if (!peer || peer.connection.connectionState !== "connected") return;
    const pc = peer.connection;
    try {
      const offer = await pc.createOffer({ iceRestart: true });
      await pc.setLocalDescription(offer);
      this.emitSignal(peerNodeId, { type: "webrtc_offer", sdp: offer.sdp! });
    } catch {
      return; // give up silently this cycle — the existing TURN connection is untouched, try again next interval
    }
    // No failsafe timer, no disconnect on timeout — worst case the
    // renegotiation doesn't land and detectRelayUsage() just confirms
    // we're still on TURN, same as if we'd never tried.
    setTimeout(() => {
      if (this.peers.get(peerNodeId)?.connection === pc) this.detectRelayUsage(peerNodeId);
    }, TURN_UPGRADE_CHECK_DELAY_MS);
  }

  // Routes an outgoing signal (offer/answer/ICE) to its destination: through
  // a relay peer's DataChannel if relayViaPeer has one for this target AND
  // that relay's channel is actually open right now, otherwise through
  // Railway (the callbacks.sendSignal path) same as before this feature
  // existed. Falling through to Railway when the relay looks dead (rather
  // than silently dropping the signal) means a mid-handshake relay
  // disconnect degrades to "no worse than not having tried a relay", not a
  // stuck connection attempt.
  private emitSignal(toNodeId: string, payload: { type: "webrtc_offer" | "webrtc_answer" | "ice_candidate"; sdp?: string; candidate?: string }) {
    const viaPeerId = this.relayViaPeer.get(toNodeId);
    if (viaPeerId) {
      const relay = this.peers.get(viaPeerId);
      if (relay?.channel?.readyState === "open") {
        relay.channel.send(JSON.stringify({
          kind: "signal_relay", toNodeId, fromNodeId: this.selfNodeId, hops: 0, ...payload,
        }));
        return;
      }
    }
    this.callbacks.sendSignal({ ...payload, toNodeId });
  }

  // Received on a relay's DataChannel. Two cases:
  //   1. Addressed to us — this is signaling relayed on our behalf by
  //      peerNodeId (our directly-connected voucher). Remember that path
  //      (so our reply goes back the same one hop) and hand it to the same
  //      handleOffer/handleAnswer/handleIceCandidate as a Railway-sourced
  //      signal would get.
  //   2. Addressed to someone else — we're the voucher being asked to carry
  //      it the last hop. Only ever forwarded once (MAX_RELAY_HOPS) and only
  //      if we actually have an open channel to that target; otherwise
  //      dropped rather than searched further, so this never grows into a
  //      multi-hop flood.
  private handleSignalRelay(peerNodeId: string, msg: any) {
    const { toNodeId, fromNodeId, type, sdp, candidate, hops } = msg;
    if (typeof toNodeId !== "string" || typeof fromNodeId !== "string") return;

    if (toNodeId === this.selfNodeId) {
      if (type === "webrtc_offer" && typeof sdp === "string") {
        this.handleOffer(fromNodeId, sdp, peerNodeId);
      } else if (type === "webrtc_answer" && typeof sdp === "string") {
        this.relayViaPeer.set(fromNodeId, peerNodeId);
        this.handleAnswer(fromNodeId, sdp);
      } else if (type === "ice_candidate" && typeof candidate === "string") {
        this.handleIceCandidate(fromNodeId, candidate);
      }
      return;
    }

    if (typeof hops !== "number" || hops >= MAX_RELAY_HOPS) return; // one hop only
    const target = this.peers.get(toNodeId);
    if (target?.channel?.readyState !== "open") return; // we're not actually a voucher for this target — drop
    target.channel.send(JSON.stringify({ kind: "signal_relay", toNodeId, fromNodeId, type, sdp, candidate, hops: hops + 1 }));
  }

  // Answers another peer's range_request from our OWN IndexedDB block-store
  // (see block-store.ts) — this is what makes a lightnode an actual gap-fill
  // source for other lightnodes, not just a live-tip relay. Only replies
  // when we actually have something (blocks.length > 0) — an empty reply
  // would just be wasted bandwidth for no information gain, the requester's
  // timeout already covers "nobody had it".
  private async handleRangeRequest(peerNodeId: string, requestId: string, fromHeight: number, toHeight: number) {
    if (typeof fromHeight !== "number" || typeof toHeight !== "number" || toHeight < fromHeight) return;
    const blocks = await getRange(fromHeight, toHeight);
    if (blocks.length === 0) return;
    const peer = this.peers.get(peerNodeId);
    if (peer?.channel?.readyState === "open") {
      peer.channel.send(JSON.stringify({ kind: "range_response", requestId, blocks }));
    }
  }

  // Answers a peer's peer_list_request with our own currently-connected
  // peer IDs — not knownPeers, deliberately: forwarding third-hand hearsay
  // would let a rumor about a long-gone node echo around the mesh forever.
  // Only ever a peer's own FIRST-HAND connection list gets passed on, so
  // "how do you know about X" is always answerable in exactly one hop.
  private handlePeerListRequest(peerNodeId: string) {
    const peer = this.peers.get(peerNodeId);
    if (peer?.channel?.readyState === "open") {
      peer.channel.send(JSON.stringify({ kind: "peer_list_response", peerIds: this.connectedPeerIds }));
    }
  }

  private handlePeerListResponse(fromPeerId: string, peerIds: unknown) {
    if (!Array.isArray(peerIds)) return;
    const now = Date.now();
    for (const [id, entry] of this.knownPeers) {
      if (now - entry.lastSeenAt > KNOWN_PEER_TTL_MS) this.knownPeers.delete(id);
    }
    for (const id of peerIds.slice(0, MAX_PEER_LIST_ENTRIES_PER_RESPONSE)) {
      if (typeof id !== "string" || id.length === 0 || id.length > 128) continue;
      if (id === fromPeerId) continue; // that's just them describing themselves, not news
      if (this.peers.has(id)) continue; // already directly connected — no need to track as "known"
      if (this.knownPeers.size >= MAX_KNOWN_PEERS && !this.knownPeers.has(id)) continue; // at cap, skip new entries
      this.knownPeers.set(id, { nodeId: id, viaPeerId: fromPeerId, lastSeenAt: now });
    }
  }

  // Inspects the connection's active candidate pair via getStats() to work
  // out whether this peer's traffic is flowing through a TURN relay rather
  // than a direct/STUN path. Run once right after the DataChannel opens —
  // the selected pair doesn't change mid-session under normal operation,
  // so a single check here is enough (an ICE restart re-triggers wireChannel
  // via a fresh onopen, which re-runs this anyway).
  private async detectRelayUsage(peerNodeId: string) {
    const peer = this.peers.get(peerNodeId);
    if (!peer) return;
    try {
      const stats = await peer.connection.getStats();
      let usingTurn = false;
      const candidates = new Map<string, any>();
      let selectedPairId: string | null = null;
      stats.forEach((report: any) => {
        if (report.type === "local-candidate" || report.type === "remote-candidate") {
          candidates.set(report.id, report);
        } else if (report.type === "candidate-pair" && (report.state === "succeeded" || report.selected)) {
          // Prefer the explicitly selected pair; if several "succeeded"
          // pairs show up, the last one wins — in practice there's only one.
          selectedPairId = report.id;
          const local = candidates.get(report.localCandidateId);
          const remote = candidates.get(report.remoteCandidateId);
          if (local?.candidateType === "relay" || remote?.candidateType === "relay") {
            usingTurn = true;
          }
        }
      });
      if (selectedPairId === null) return; // stats not ready yet — leave usingTurn as null rather than guess
      peer.usingTurn = usingTurn;
    } catch {
      // getStats() failing shouldn't take down the connection — just leave
      // usingTurn as null (not counted as TURN, not counted as direct).
    }
  }

  private wireChannel(peerNodeId: string, channel: RTCDataChannel) {
    const peer = this.peers.get(peerNodeId);
    if (peer) peer.channel = channel;

    channel.onopen = async () => {
      this.knownPeers.delete(peerNodeId); // now directly connected — no longer just a hint
      this.relayViaPeer.delete(peerNodeId); // direct path exists now, stop routing signals for it through a relay
      // Awaited so turnPeerCount is already accurate by the time
      // onPeerConnected fires and the panel re-reads peer counts —
      // otherwise the UI would briefly show this peer as "not TURN"
      // before the async getStats() check resolves a moment later.
      await this.detectRelayUsage(peerNodeId);
      this.startPeerPing(peerNodeId);
      this.callbacks.onPeerConnected?.(peerNodeId);
    };
    channel.onclose = () => this.callbacks.onPeerDisconnected?.(peerNodeId);
    channel.onmessage = (ev) => {
      const p = this.peers.get(peerNodeId);
      if (p) p.lastSeenAt = Date.now(); // any traffic counts as "alive", not just pong
      try {
        const parsed = JSON.parse(ev.data);
        if (parsed?.kind === "header" && parsed.header) {
          this.callbacks.onPeerHeader(peerNodeId, parsed.header);
        } else if (parsed?.kind === "range_request" && parsed.requestId) {
          this.handleRangeRequest(peerNodeId, parsed.requestId, parsed.fromHeight, parsed.toHeight);
        } else if (parsed?.kind === "range_response" && parsed.requestId) {
          const pending = this.pendingRangeRequests.get(parsed.requestId);
          if (pending && Array.isArray(parsed.blocks)) {
            for (const b of parsed.blocks) {
              if (typeof b?.height === "number") pending.received.set(b.height, b);
            }
          }
        } else if (parsed?.kind === "peer_list_request") {
          this.handlePeerListRequest(peerNodeId);
        } else if (parsed?.kind === "peer_list_response") {
          this.handlePeerListResponse(peerNodeId, parsed.peerIds);
        } else if (parsed?.kind === "signal_relay") {
          this.handleSignalRelay(peerNodeId, parsed);
        } else if (parsed?.kind === "ping") {
          // Reply immediately, echoing sentAt so the pinger can compute
          // round-trip time without needing clock sync between peers.
          channel.readyState === "open" && channel.send(JSON.stringify({ kind: "pong", sentAt: parsed.sentAt }));
        } else if (parsed?.kind === "pong" && p) {
          p.latencyMs = Date.now() - parsed.sentAt;
        }
      } catch {
        // Malformed peer payload — drop it. Not our job to police the peer's
        // JSON here; verifyHeader() downstream is the actual trust boundary.
      }
    };
  }

  // Per-peer DataChannel heartbeat/latency — independent of the client<->hub
  // WS ping/heartbeat (see client.ts's startHeartbeat). Measures the actual
  // P2P path's round-trip time, which is what matters for mesh health/PoC
  // scoring between peers rather than each peer's individual link to Railway.
  private startPeerPing(peerNodeId: string) {
    const peer = this.peers.get(peerNodeId);
    if (!peer) return;
    if (peer.pingTimer) clearInterval(peer.pingTimer);
    const sendPing = () => {
      const p = this.peers.get(peerNodeId);
      if (!p?.channel || p.channel.readyState !== "open") return;
      p.pingSentAt = Date.now();
      p.channel.send(JSON.stringify({ kind: "ping", sentAt: p.pingSentAt }));
    };
    sendPing(); // first one immediately — don't wait a full interval for the initial reading
    peer.pingTimer = setInterval(sendPing, PEER_PING_INTERVAL_MS);
  }

  // Snapshot for the UI — client.ts polls this rather than the mesh
  // pushing a callback per ping, since per-peer latency changing is not
  // urgent enough to need a dedicated event.
  getPeerStats(): Array<{ nodeId: string; latencyMs: number | null; lastSeenAt: number; usingTurn: boolean | null }> {
    return [...this.peers.entries()].map(([nodeId, p]) => ({
      nodeId, latencyMs: p.latencyMs, lastSeenAt: p.lastSeenAt, usingTurn: p.usingTurn,
    }));
  }
}
