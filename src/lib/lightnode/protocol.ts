// Mirrors railway-server/src/types.ts — keep both in sync when changing.
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
}

export interface WelcomeMessage {
  type: "welcome";
  network: "EAST";
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

export interface PingMessage { type: "ping"; }
export interface PongMessage { type: "pong"; time: number; }
export interface ErrorMessage { type: "error"; message: string; }

export type InboundMessage =
  | WelcomeMessage | BlockNewMessage | BlockBackfillMessage | PongMessage | ErrorMessage;
