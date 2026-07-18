"use client"

// ─── EAST Light Node — WebRTC peer mesh ────────────────────────────────
// Optional bandwidth/resilience layer on top of the Railway hub, not a
// replacement for it. Railway remains the ONLY introduction point (it
// relays offer/answer/ICE blind, see railway-server's webrtc_offer/
// webrtc_answer/ice_candidate handlers) — peers never discover each
// other any other way.
//
// SECURITY INVARIANT: a header arriving over a peer DataChannel goes
// through the exact same verifyHeader() check in client.ts as one that
// arrived from Railway directly. This file never marks anything as
// "verified" — it only moves bytes. A malicious or broken peer can waste
// your bandwidth with garbage; it cannot get a bad header accepted.
//
// STUN only, no TURN — connections that need a relay to traverse NAT
// (symmetric NAT on both sides) simply won't establish, and that peer
// pair silently falls back to Railway's own header stream. This is a
// deliberate scope cut: TURN needs paid relay bandwidth, and losing a
// P2P shortcut degrades gracefully to "no worse than today" rather than
// breaking anything.
const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

const DATACHANNEL_LABEL = "headers";

export interface PeerMeshCallbacks {
  /** Send a signaling message out over the existing Railway WS connection. */
  sendSignal: (msg: { type: "webrtc_offer" | "webrtc_answer" | "ice_candidate"; toNodeId: string; sdp?: string; candidate?: string }) => void;
  /** A header arrived from a peer — hand it to the SAME verifyHeader() path as Railway-sourced headers. */
  onPeerHeader: (peerNodeId: string, header: unknown) => void;
  onPeerConnected?: (peerNodeId: string) => void;
  onPeerDisconnected?: (peerNodeId: string) => void;
  /** A peer is asking whether we have blocks in this range in our local
   *  (min. 1000 block) cache — see BLOCK_CACHE_SIZE in client.ts. */
  onBackfillRequest?: (peerNodeId: string, fromHeight: number, toHeight: number) => void;
  /** A peer answered one of our backfill requests with headers it had cached. */
  onBackfillResponse?: (peerNodeId: string, headers: unknown[]) => void;
}

interface Peer {
  connection: RTCPeerConnection;
  channel: RTCDataChannel | null;
}

export class PeerMesh {
  private peers = new Map<string, Peer>();
  private callbacks: PeerMeshCallbacks;

  constructor(callbacks: PeerMeshCallbacks) {
    this.callbacks = callbacks;
  }

  get connectedPeerIds(): string[] {
    return [...this.peers.entries()]
      .filter(([, p]) => p.channel?.readyState === "open")
      .map(([id]) => id);
  }

  /** Initiate a connection to a promoted relay node (we are the offerer). */
  async connectTo(peerNodeId: string) {
    if (this.peers.has(peerNodeId)) return; // already connecting/connected
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

  /** Push our latest known header(s) out to every connected peer (best-effort gossip). */
  broadcastHeader(header: unknown) {
    const msg = JSON.stringify({ kind: "header", header });
    this.peers.forEach((peer) => {
      if (peer.channel?.readyState === "open") peer.channel.send(msg);
    });
  }

  /** Ask every connected peer whether they have this height range in their
   *  local cache. Whoever does answers via onBackfillResponse. Best-effort
   *  broadcast — this is what "R2 archive" was replaced with: the swarm
   *  itself, not a central store. */
  requestBackfill(fromHeight: number, toHeight: number) {
    const msg = JSON.stringify({ kind: "backfill_request", fromHeight, toHeight });
    this.peers.forEach((peer) => {
      if (peer.channel?.readyState === "open") peer.channel.send(msg);
    });
  }

  /** Answer a specific peer's backfill_request with whatever headers we had cached. */
  respondBackfill(peerNodeId: string, headers: unknown[]) {
    const peer = this.peers.get(peerNodeId);
    if (peer?.channel?.readyState === "open") {
      peer.channel.send(JSON.stringify({ kind: "backfill_response", headers }));
    }
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

  private wireChannel(peerNodeId: string, channel: RTCDataChannel) {
    const peer = this.peers.get(peerNodeId);
    if (peer) peer.channel = channel;

    channel.onopen = () => this.callbacks.onPeerConnected?.(peerNodeId);
    channel.onclose = () => this.callbacks.onPeerDisconnected?.(peerNodeId);
    channel.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(ev.data);
        if (parsed?.kind === "header" && parsed.header) {
          this.callbacks.onPeerHeader(peerNodeId, parsed.header);
        } else if (parsed?.kind === "backfill_request" && typeof parsed.fromHeight === "number" && typeof parsed.toHeight === "number") {
          this.callbacks.onBackfillRequest?.(peerNodeId, parsed.fromHeight, parsed.toHeight);
        } else if (parsed?.kind === "backfill_response" && Array.isArray(parsed.headers)) {
          this.callbacks.onBackfillResponse?.(peerNodeId, parsed.headers);
        }
      } catch {
        // Malformed peer payload — drop it. Not our job to police the peer's
        // JSON here; verifyHeader() downstream is the actual trust boundary.
      }
    };
  }
}
