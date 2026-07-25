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
// without going through Railway (peer-relayed signaling) is a deliberate
// next step, not built here yet.
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
// STUN only, no TURN — connections that need a relay to traverse NAT
// (symmetric NAT on both sides) simply won't establish, and that peer
// pair silently falls back to Railway's own header stream. This is a
// deliberate scope cut: TURN needs paid relay bandwidth, and losing a
// P2P shortcut degrades gracefully to "no worse than today" rather than
// breaking anything.
import { getRange } from "./block-store";

const ICE_SERVERS: RTCIceServer[] = [
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

export interface PeerMeshCallbacks {
  /** Send a signaling message out over the existing Railway WS connection. */
  sendSignal: (msg: { type: "webrtc_offer" | "webrtc_answer" | "ice_candidate"; toNodeId: string; sdp?: string; candidate?: string }) => void;
  /** A header arrived from a peer — hand it to the SAME verifyHeader() path as Railway-sourced headers. */
  onPeerHeader: (peerNodeId: string, header: unknown) => void;
  onPeerConnected?: (peerNodeId: string) => void;
  onPeerDisconnected?: (peerNodeId: string) => void;
}

interface Peer {
  connection: RTCPeerConnection;
  channel: RTCDataChannel | null;
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

export class PeerMesh {
  private peers = new Map<string, Peer>();
  private callbacks: PeerMeshCallbacks;
  private pendingRangeRequests = new Map<string, PendingRangeRequest>();
  // Peer Exchange (PEX) directory — nodeIds we've heard about from a
  // connected peer but aren't (yet) directly connected to ourselves. This
  // is deliberately just a hint list for now: without a signaling path to
  // an unconnected nodeId, knowing it exists doesn't let us reach it. What
  // it DOES give us today: visibility into how much bigger the mesh is
  // than our own direct connections, and groundwork for peer-relayed
  // signaling later (a connected peer vouching for/relaying to someone in
  // its own list) without needing another protocol change to add that.
  private knownPeers = new Map<string, KnownPeer>();

  constructor(callbacks: PeerMeshCallbacks) {
    this.callbacks = callbacks;
  }

  get connectedPeerIds(): string[] {
    return [...this.peers.entries()]
      .filter(([, p]) => p.channel?.readyState === "open")
      .map(([id]) => id);
  }

  /** Everyone we've learned about via Peer Exchange, whether or not we're
   *  directly connected to them ourselves — see the knownPeers field comment. */
  get knownPeerIds(): string[] {
    return [...this.knownPeers.keys()];
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

  /** Initiate a connection to a promoted relay node (we are the offerer). */
  async connectTo(peerNodeId: string) {
    if (this.peers.has(peerNodeId)) return; // already connecting/connected
    if (this.peers.size >= MAX_MESH_PEERS) return; // at cap — this pair falls back to Railway directly instead
    const pc = this.createConnection(peerNodeId);
    const channel = pc.createDataChannel(DATACHANNEL_LABEL);
    this.wireChannel(peerNodeId, channel);
    this.peers.set(peerNodeId, { connection: pc, channel });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.callbacks.sendSignal({ type: "webrtc_offer", toNodeId: peerNodeId, sdp: offer.sdp });
  }

  /** Someone offered us a connection (we are the answerer). */
  async handleOffer(fromNodeId: string, sdp: string) {
    if (!this.peers.has(fromNodeId) && this.peers.size >= MAX_MESH_PEERS) return; // at cap — decline, offerer falls back to Railway
    const pc = this.createConnection(fromNodeId);
    pc.ondatachannel = (ev) => this.wireChannel(fromNodeId, ev.channel);
    this.peers.set(fromNodeId, { connection: pc, channel: null });

    await pc.setRemoteDescription({ type: "offer", sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.callbacks.sendSignal({ type: "webrtc_answer", toNodeId: fromNodeId, sdp: answer.sdp });
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
    peer.channel?.close();
    peer.connection.close();
    this.peers.delete(peerNodeId);
  }

  disconnectAll() {
    [...this.peers.keys()].forEach((id) => this.disconnect(id));
  }

  private createConnection(peerNodeId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        this.callbacks.sendSignal({
          type: "ice_candidate", toNodeId: peerNodeId, candidate: JSON.stringify(ev.candidate),
        });
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        this.disconnect(peerNodeId);
        this.callbacks.onPeerDisconnected?.(peerNodeId);
      }
    };
    return pc;
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

  private wireChannel(peerNodeId: string, channel: RTCDataChannel) {
    const peer = this.peers.get(peerNodeId);
    if (peer) peer.channel = channel;

    channel.onopen = () => {
      this.knownPeers.delete(peerNodeId); // now directly connected — no longer just a hint
      this.callbacks.onPeerConnected?.(peerNodeId);
    };
    channel.onclose = () => this.callbacks.onPeerDisconnected?.(peerNodeId);
    channel.onmessage = (ev) => {
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
        }
      } catch {
        // Malformed peer payload — drop it. Not our job to police the peer's
        // JSON here; verifyHeader() downstream is the actual trust boundary.
      }
    };
  }
}
