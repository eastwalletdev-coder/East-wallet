#!/usr/bin/env node
/**
 * EASTCHAIN — Local Full-Ledger Store
 * ─────────────────────────────────────────────────────────────────────
 * A validator daemon's local copy of the chain: one JSON object per line
 * (JSON Lines / .jsonl), appended to as blocks arrive. Deliberately NOT
 * SQLite — better-sqlite3/sqlite3 need node-gyp to compile their native
 * binding, which is a common source of install failures on Termux
 * (Android) and on VPS boxes without build-essential installed. Plain
 * fs + JSON parses/writes fine everywhere Node itself runs.
 *
 * Not meant to scale to millions of blocks — it's fine for a chain still
 * in the low thousands of blocks. If EASTCHAIN's height gets large enough
 * that a full linear jsonl scan becomes slow, revisit this (e.g. one file
 * per N blocks) rather than reaching for a native DB dependency.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_LEDGER_PATH = path.join(__dirname, '..', '.eastchain-local-ledger.jsonl');

class LocalLedger {
  constructor(ledgerPath = process.env.EASTCHAIN_LEDGER_PATH || DEFAULT_LEDGER_PATH) {
    this.ledgerPath = ledgerPath;
    // height -> byte offset in the file, built once at startup so
    // hasBlock()/getBlock() don't need a full file scan per call.
    this.index = new Map();
    this._loadIndex();
  }

  _loadIndex() {
    if (!fs.existsSync(this.ledgerPath)) return;
    const lines = fs.readFileSync(this.ledgerPath, 'utf8').split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const block = JSON.parse(line);
        this.index.set(block.height, block);
      } catch {
        // A truncated last line (e.g. daemon killed mid-write) — skip it,
        // don't let one bad line take down the whole ledger load.
      }
    }
  }

  getLatestHeight() {
    if (this.index.size === 0) return -1;
    return Math.max(...this.index.keys());
  }

  hasBlock(height) {
    return this.index.has(height);
  }

  getBlock(height) {
    return this.index.get(height) ?? null;
  }

  /** Inclusive range, only the blocks actually present (gaps just get skipped). */
  getRange(fromHeight, toHeight) {
    const out = [];
    for (let h = fromHeight; h <= toHeight; h++) {
      if (this.index.has(h)) out.push(this.index.get(h));
    }
    return out;
  }

  /** Idempotent — re-appending a height we already have is a silent no-op. */
  appendBlock(block) {
    if (typeof block.height !== 'number' || !block.hash) {
      throw new Error('appendBlock: block must have numeric height and hash');
    }
    if (this.index.has(block.height)) return false;
    fs.appendFileSync(this.ledgerPath, JSON.stringify(block) + '\n');
    this.index.set(block.height, block);
    return true;
  }

  /** How many blocks are actually stored (not the same as latestHeight+1 if there are gaps). */
  get size() {
    return this.index.size;
  }
}

module.exports = { LocalLedger, DEFAULT_LEDGER_PATH };
