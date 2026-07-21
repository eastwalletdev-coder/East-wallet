// Mirrors railway-server/src/types.ts — keep both in sync when changing.
import { EAST_CHAIN_ID } from "@/lib/contracts/registry";

export type Role = "validator" | "light-node";

export interface BlockHeader {
  height: number;
  hash: string;
  previousHash: string;
  merkleRoot: string;
  validator: string | null;
  timestamp: number;
  epoch: number;
  signature?: string | null; // 0x-prefixed secp256k1 EIP-191 sig over `EASTCHAIN_BLOCK|{height}|{hash}` — see chain-signing.ts
}

export interface HelloMessage {
  type: "hello";
  role: Role;
  nodeId: string;
  chainId: number; // always EAST_CHAIN_ID — see registry.ts
}

export interface WelcomeMessage {
  type: "welcome";
  network: "EAST";
  chainId: number;
  version: string;
  role: Role;
  latestHeight: number;
}

export interface BlockNewMessage {
  type: "block:new";
  header: BlockHeader;
}

export interface BlockBackfillMessage {
  type: "block:backfill";
  headers: BlockHeader[];
}

export interface HeartbeatMessage {
  type: "heartbeat";
  nodeId: string;
  height: number;
  timestamp: number;
}

export interface SyncRequestMessage {
  type: "sync_request";
  nodeId: string;
  fromHeight: number;
}

export interface AckMessage {
  type: "ack";
  nodeId: string;
  height: number;
  timestamp: number;
}

// ── Relay scoring & promotion (see railway-server's recomputeRelayRoster) ──
export interface RelayStatsMessage {
  type: "relay_stats";
  nodeId: string;
  avgLatencyMs: number;
  participationSeconds: number;
  verifiedHeaderCount: number;
}
export interface RelayRosterMessage { type: "relay:roster"; relayNodeIds: string[]; }
export interface RelayPromotedMessage { type: "relay:promoted"; }
export interface RelayDemotedMessage { type: "relay:demoted"; }

// ── WebRTC signaling passthrough — Railway forwards these blind ────────
export interface WebrtcOfferMessage { type: "webrtc_offer"; fromNodeId?: string; toNodeId: string; sdp: string; }
export interface WebrtcAnswerMessage { type: "webrtc_answer"; fromNodeId?: string; toNodeId: string; sdp: string; }
export interface IceCandidateMessage { type: "ice_candidate"; fromNodeId?: string; toNodeId: string; candidate: string; }

export interface PingMessage { type: "ping"; }
export interface PongMessage { type: "pong"; time: number; }
export interface ErrorMessage { type: "error"; message: string; }

// ── Full-sync (large gap catch-up via a peer, see client.ts full_sync_request) ──
export interface FullSyncProvidersMessage { type: "full_sync_providers"; nodeIds: string[]; }
export interface FullSyncResponseMessage { type: "full_sync_response"; fromNodeId: string; blocks: BlockHeader[]; }

export type InboundMessage =
  | WelcomeMessage | BlockNewMessage | BlockBackfillMessage | PongMessage | ErrorMessage
  | RelayRosterMessage | RelayPromotedMessage | RelayDemotedMessage
  | FullSyncProvidersMessage | FullSyncResponseMessage
  | WebrtcOfferMessage | WebrtcAnswerMessage | IceCandidateMessage;

export { EAST_CHAIN_ID };
