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
// your bandwidth with garbage; it cannot get a bad header accepted. This
// applies just as much to range_response blocks as to live header gossip
// — client.ts runs every block returned here through applyHeader() same
// as anything else.
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

export class PeerMesh {
  private peers = new Map<string, Peer>();
  private callbacks: PeerMeshCallbacks;
  private pendingRangeRequests = new Map<string, PendingRangeRequest>();

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
        } else if (parsed?.kind === "range_request" && parsed.requestId) {
          this.handleRangeRequest(peerNodeId, parsed.requestId, parsed.fromHeight, parsed.toHeight);
        } else if (parsed?.kind === "range_response" && parsed.requestId) {
          const pending = this.pendingRangeRequests.get(parsed.requestId);
          if (pending && Array.isArray(parsed.blocks)) {
            for (const b of parsed.blocks) {
              if (typeof b?.height === "number") pending.received.set(b.height, b);
            }
          }
        }
      } catch {
        // Malformed peer payload — drop it. Not our job to police the peer's
        // JSON here; verifyHeader() downstream is the actual trust boundary.
      }
    };
  }
}
