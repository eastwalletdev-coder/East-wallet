/**
 * Enhanced structured logging for Light Node — mirrors Railway's logging style
 * with timestamps, levels, and categorized events for easier debugging.
 * 
 * Logs are stored in-memory and persisted to localStorage for inspection.
 */

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR" | "SYNC";
export type LogCategory = "connection" | "sync" | "verification" | "peer" | "archive" | "relay" | "heartbeat" | "storage" | "config";

export interface StructuredLog {
  timestamp: number;
  level: LogLevel;
  category: LogCategory;
  message: string;
  data?: Record<string, any>;
  nodeId?: string;
}

const LOG_STORAGE_KEY = "east_lightnode_logs_v1";
const MAX_LOGS_IN_MEMORY = 500;
const MAX_LOGS_IN_STORAGE = 1000;

export class LightNodeLogger {
  private logs: StructuredLog[] = [];
  private nodeId: string;

  constructor(nodeId: string) {
    this.nodeId = nodeId;
    this.loadFromStorage();
  }

  /**
   * Log with structured data — mirrors Railway hub logging format
   */
  log(
    level: LogLevel,
    category: LogCategory,
    message: string,
    data?: Record<string, any>
  ) {
    const entry: StructuredLog = {
      timestamp: Date.now(),
      level,
      category,
      message,
      data,
      nodeId: this.nodeId,
    };

    this.logs.push(entry);
    if (this.logs.length > MAX_LOGS_IN_MEMORY) {
      this.logs = this.logs.slice(-MAX_LOGS_IN_MEMORY);
    }

    // Persist periodically
    if (this.logs.length % 50 === 0) {
      this.persistToStorage();
    }

    // Mirror to console with styling
    this.printToConsole(entry);
  }

  // ── Convenience methods for common scenarios ──

  debug(category: LogCategory, message: string, data?: Record<string, any>) {
    this.log("DEBUG", category, message, data);
  }

  info(category: LogCategory, message: string, data?: Record<string, any>) {
    this.log("INFO", category, message, data);
  }

  warn(category: LogCategory, message: string, data?: Record<string, any>) {
    this.log("WARN", category, message, data);
  }

  error(category: LogCategory, message: string, data?: Record<string, any>) {
    this.log("ERROR", category, message, data);
  }

  sync(message: string, data?: Record<string, any>) {
    this.log("SYNC", "sync", message, data);
  }

  // ── Connection events ──

  connectionAttempt(url: string) {
    this.info("connection", "🔌 Attempting WebSocket connection", { url });
  }

  connectionEstablished(latencyMs?: number) {
    this.info("connection", "✅ WebSocket connected", { latencyMs });
  }

  connectionClosed(code?: number, reason?: string) {
    this.info("connection", "❌ WebSocket disconnected", { code, reason });
  }

  connectionError(error: string, attempt?: number, maxAttempts?: number) {
    this.error("connection", "🔥 Connection error", {
      error,
      attempt,
      maxAttempts,
      retrying: attempt ? attempt < (maxAttempts ?? 10) : undefined,
    });
  }

  reconnectScheduled(delayMs: number, attempt: number) {
    this.warn("connection", `⏱️ Reconnecting in ${Math.round(delayMs / 1000)}s`, {
      delayMs,
      attempt,
    });
  }

  // ── Sync events ──

  syncStarted(currentHeight: number, targetHeight: number, gap: number) {
    this.sync(`📡 Sync started (gap: ${gap} blocks)`, {
      currentHeight,
      targetHeight,
      gap,
    });
  }

  syncPhaseChanged(oldPhase: string, newPhase: string) {
    this.sync(`⏸️ Sync phase: ${oldPhase} → ${newPhase}`, { oldPhase, newPhase });
  }

  syncProgress(current: number, total: number, stage: string) {
    const percent = Math.round((current / total) * 100);
    this.sync(`${stage} [${current}/${total} - ${percent}%]`, {
      current,
      total,
      percent,
      stage,
    });
  }

  syncComplete(blocksVerified: number, durationMs: number) {
    this.sync(`✅ Sync complete (${blocksVerified} blocks verified)`, {
      blocksVerified,
      durationMs,
      blocksPerSec: (blocksVerified / (durationMs / 1000)).toFixed(2),
    });
  }

  syncStalled(currentHeight: number, targetHeight: number, stalledForMs: number) {
    this.error("sync", `⚠️ Sync stalled`, {
      currentHeight,
      targetHeight,
      stalledForMs,
      gap: targetHeight - currentHeight,
    });
  }

  // ── Block verification ──

  blockVerified(height: number, hash: string, signature?: string) {
    this.info("verification", `✅ Block #${height} verified`, {
      height,
      hash: hash.slice(0, 16),
      signed: !!signature,
    });
  }

  blockRejected(height: number, hash: string, reason: string) {
    this.error("verification", `❌ Block #${height} rejected`, {
      height,
      hash: hash.slice(0, 16),
      reason,
    });
  }

  signatureVerified(height: number, signer: string) {
    this.debug("verification", `🔐 Signature verified for block #${height}`, {
      height,
      signer: signer.slice(0, 16),
    });
  }

  signatureFailed(height: number, reason: string) {
    this.error("verification", `❌ Signature failed for block #${height}`, {
      height,
      reason,
    });
  }

  // ── Backfill events ──

  backfillReceived(count: number, fromHeight: number, toHeight: number) {
    this.info("sync", `📥 Backfill received (${count} blocks)`, {
      count,
      fromHeight,
      toHeight,
      range: `#${fromHeight}-#${toHeight}`,
    });
  }

  backfillProcessing(current: number, total: number) {
    this.sync(`⚙️ Processing backfill [${current}/${total}]`, { current, total });
  }

  backfillEmpty() {
    this.warn("sync", "⚠️ No backfill available from Railway");
  }

  // ── Archive events ──

  archiveFetchStarted(fromHeight: number, toHeight: number, totalBlocks: number) {
    this.info("archive", `📦 Fetching from archive (#${fromHeight}–#${toHeight})`, {
      fromHeight,
      toHeight,
      totalBlocks,
    });
  }

  archiveBlockFetched(height: number, success: boolean) {
    if (success) {
      this.debug("archive", `✅ Archive block #${height} fetched`, { height });
    } else {
      this.warn("archive", `❌ Archive block #${height} missing`, { height });
    }
  }

  archiveFetchBatch(batchNum: number, blocksInBatch: number, totalFetched: number) {
    this.sync(`📥 Archive batch ${batchNum} (${blocksInBatch} blocks, total: ${totalFetched})`, {
      batchNum,
      blocksInBatch,
      totalFetched,
    });
  }

  archiveFetchComplete(totalFetched: number, durationMs: number) {
    this.info("archive", `✅ Archive fetch complete (${totalFetched} blocks)`, {
      totalFetched,
      durationMs,
      throughputBlocksPerSec: (totalFetched / (durationMs / 1000)).toFixed(2),
    });
  }

  archiveFallback(height: number, reason: string) {
    this.warn("archive", `⚠️ Archive fallback at block #${height}`, {
      height,
      reason,
      fallingBackTo: "Railway",
    });
  }

  // ── Peer sync events ──

  peerSyncRequested(peerId: string, fromHeight: number, toHeight: number) {
    this.info("peer", `🔗 Requesting #${fromHeight}–#${toHeight} from peer ${peerId.slice(0, 8)}…`, {
      peerId: peerId.slice(0, 8),
      fromHeight,
      toHeight,
      range: toHeight - fromHeight + 1,
    });
  }

  peerSyncReceived(peerId: string, blockCount: number, currentHeight: number) {
    this.info("peer", `✅ Peer sent ${blockCount} blocks, now at #${currentHeight}`, {
      peerId: peerId.slice(0, 8),
      blockCount,
      currentHeight,
    });
  }

  peerSyncTimeout(peerId: string, timeoutMs: number) {
    this.warn("peer", `⏱️ Peer ${peerId.slice(0, 8)}… timed out`, {
      peerId: peerId.slice(0, 8),
      timeoutMs,
      fallingBackTo: "archive/Railway",
    });
  }

  peerConnected(peerId: string, latencyMs?: number) {
    this.info("peer", `✅ Peer connected: ${peerId.slice(0, 8)}…`, {
      peerId: peerId.slice(0, 8),
      latencyMs,
    });
  }

  peerDisconnected(peerId: string) {
    this.warn("peer", `❌ Peer disconnected: ${peerId.slice(0, 8)}…`, {
      peerId: peerId.slice(0, 8),
    });
  }

  // ── Heartbeat events ──

  heartbeatSent(height: number, latencyMs?: number) {
    this.debug("heartbeat", `💓 Heartbeat sent (#${height})`, {
      height,
      latencyMs,
    });
  }

  heartbeatReceived(latencyMs: number) {
    this.debug("heartbeat", `💚 Pong received`, { latencyMs });
  }

  // ── Relay events ──

  relayPromoted() {
    this.info("relay", `🎖️ Promoted to relay node (top-N tier)`);
  }

  relayDemoted() {
    this.warn("relay", `📉 Demoted from relay node`);
  }

  relayStatsReported(latencyMs: number, participationSec: number, verifiedCount: number) {
    this.debug("relay", `📊 Relay stats reported`, {
      latencyMs,
      participationSec,
      verifiedCount,
    });
  }

  // ── Storage/Eligibility ──

  eligibilityAchieved(participationSec: number, verifiedCount: number) {
    this.info("storage", `🏆 Reward eligible (${participationSec}s, ${verifiedCount} headers)`, {
      participationSec,
      verifiedCount,
    });
  }

  claimSucceeded(epochLabel: string) {
    this.info("storage", `💰 Claim succeeded (${epochLabel})`, { epochLabel });
  }

  // ── Config/Network ──

  configLoaded(config: Record<string, any>) {
    this.info("config", `⚙️ Configuration loaded`, config);
  }

  chainHeightResolved(height: number, source: string) {
    this.debug("config", `📍 Chain height resolved`, { height, source });
  }

  // ── Retrieval & Persistence ──

  getLogs(
    options?: {
      level?: LogLevel;
      category?: LogCategory;
      since?: number;
      limit?: number;
    }
  ): StructuredLog[] {
    let filtered = [...this.logs];

    if (options?.level) {
      filtered = filtered.filter((l) => l.level === options.level);
    }

    if (options?.category) {
      filtered = filtered.filter((l) => l.category === options.category);
    }

    if (options?.since) {
      const since = options.since;
      filtered = filtered.filter((l) => l.timestamp >= since);
    }

    if (options?.limit) {
      filtered = filtered.slice(-options.limit);
    }

    return filtered;
  }

  getErrorLogs(): StructuredLog[] {
    return this.getLogs({ level: "ERROR" });
  }

  getSyncLogs(): StructuredLog[] {
    return this.getLogs({ level: "SYNC" });
  }

  getLastN(count: number): StructuredLog[] {
    return this.logs.slice(-count);
  }

  // Export as JSON for analysis
  exportAsJson(prettyPrint: boolean = true): string {
    return prettyPrint
      ? JSON.stringify(this.logs, null, 2)
      : JSON.stringify(this.logs);
  }

  // Export as CSV for spreadsheet analysis
  exportAsCsv(): string {
    if (this.logs.length === 0) return "timestamp,level,category,message,nodeId\n";

    const headers = ["timestamp", "level", "category", "message", "nodeId", "data"];
    const rows = this.logs.map((log) => [
      new Date(log.timestamp).toISOString(),
      log.level,
      log.category,
      `"${log.message.replace(/"/g, '""')}"`, // escape quotes
      log.nodeId,
      log.data ? `"${JSON.stringify(log.data).replace(/"/g, '""')}"` : "",
    ]);

    return [headers, ...rows].map((row) => row.join(",")).join("\n");
  }

  // Export as pretty table for console
  exportAsTable(): string {
    if (this.logs.length === 0) return "No logs";

    const last50 = this.logs.slice(-50);
    let table = "┌─ LIGHT NODE LOG SUMMARY ──────────────────────────────────────┐\n";

    for (const log of last50) {
      const time = new Date(log.timestamp).toISOString().slice(11, 23); // HH:MM:SS.mmm
      const level = log.level.padEnd(5);
      const cat = log.category.padEnd(12);
      table += `│ ${time} [${level}] ${cat} ${log.message}\n`;
    }

    table += "└──────────────────────────────────────────────────────────────────┘\n";
    return table;
  }

  private persistToStorage() {
    if (typeof window === "undefined") return;
    try {
      const toStore = this.logs.slice(-MAX_LOGS_IN_STORAGE);
      localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(toStore));
    } catch (err) {
      console.warn("[LightNodeLogger] Failed to persist logs to storage:", err);
    }
  }

  private loadFromStorage() {
    if (typeof window === "undefined") return;
    try {
      const stored = localStorage.getItem(LOG_STORAGE_KEY);
      if (stored) {
        this.logs = JSON.parse(stored) as StructuredLog[];
      }
    } catch (err) {
      console.warn("[LightNodeLogger] Failed to load logs from storage:", err);
    }
  }

  clearLogs() {
    this.logs = [];
    if (typeof window !== "undefined") {
      localStorage.removeItem(LOG_STORAGE_KEY);
    }
  }

  private printToConsole(entry: StructuredLog) {
    const time = new Date(entry.timestamp).toISOString();
    const prefix = `[${time}] [${entry.level}] [${entry.category}]`;

    const levelColors: Record<LogLevel, string> = {
      DEBUG: "color: #999; font-size: 12px;",
      INFO: "color: #2563eb; font-weight: bold;",
      WARN: "color: #ea580c; font-weight: bold;",
      ERROR: "color: #dc2626; font-weight: bold; background: #fecaca; padding: 2px 4px;",
      SYNC: "color: #059669; font-weight: bold; background: #dcfce7; padding: 2px 4px;",
    };

    if (typeof console !== "undefined") {
      console.log(
        `%c${prefix}%c ${entry.message}`,
        levelColors[entry.level],
        "color: inherit;",
        entry.data ?? ""
      );
    }
  }
}

// Global logger instance
let loggerInstance: LightNodeLogger | null = null;

export function initLightNodeLogger(nodeId: string): LightNodeLogger {
  if (!loggerInstance) {
    loggerInstance = new LightNodeLogger(nodeId);
  }
  return loggerInstance;
}

export function getLightNodeLogger(): LightNodeLogger {
  if (!loggerInstance) {
    throw new Error("Logger not initialized. Call initLightNodeLogger() first.");
  }
  return loggerInstance;
}
