#!/usr/bin/env node
/**
 * EASTCHAIN — Validator Block Producer Daemon
 * ─────────────────────────────────────────────────────────────────────
 * Run this on your VPS (e.g. a Railway service) instead of
 * heartbeat-daemon.js — it does everything that one does PLUS actually
 * computes and submits blocks when this node is picked as leader.
 *
 * What it does, forever:
 *   1. Sends a heartbeat every 30s (same as heartbeat-daemon.js).
 *   2. Polls GET /api/consensus/my-proposal every ~2s to check if this
 *      node is currently the assigned leader for a pending block.
 *   3. When assigned: computes merkleRoot / sequenceHash / blockHash
 *      LOCALLY from the prevHash + txHashes Vercel gave it — the exact
 *      same algorithm as src/lib/consensus/block-math.ts. Signs the
 *      result and submits it to POST /api/consensus/submit-block.
 *   4. Vercel independently recomputes and verifies everything before
 *      accepting — a mismatch (wrong prevHash, tampered hash, bad
 *      signature, timestamp too far off) gets REJECTED, logged here,
 *      and the slot falls back to Vercel self-producing.
 *
 * IMPORTANT: leader-proposal mode only activates once there are 2+
 * active external validator nodes (fresh heartbeat, node_type='external',
 * approved). With only this one VPS running, you'll see heartbeats
 * succeed but never get assigned a proposal — that's expected, not a bug.
 *
 * REQUIREMENTS:
 *   - Same vault file as heartbeat-daemon.js / apply-validator-cli.js
 *     (.eastchain-validator-vault.json).
 *   - Must already be an APPROVED, ACTIVE validator (see
 *     /admin/validator-review and runEpoch).
 *
 * Usage:
 *   node scripts/block-producer-daemon.js
 *
 * Env vars (or prompted at startup):
 *   EASTCHAIN_API_URL       API endpoint
 *   EASTCHAIN_TELEGRAM_ID   Your Telegram ID
 *   EASTCHAIN_VAULT_PATH    Path to vault file (default: .eastchain-validator-vault.json in script dir)
 *
 * Graceful shutdown: Ctrl+C — sends a final heartbeat, then exits.
 */

const readline = require('readline');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bip39 = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const nacl = require('tweetnacl');

const EAST_DERIVATION_PATH = "m/44'/501'/0'/0'";
const DEFAULT_VAULT_PATH = path.join(__dirname, '.eastchain-validator-vault.json');
const HEARTBEAT_INTERVAL_MS = 30_000;   // must be < 90s (HEARTBEAT_FRESHNESS_SECONDS)
const POLL_PROPOSAL_INTERVAL_MS = 2_000;

let isShuttingDown = false;

// ─── Prompt helpers ─────────────────────────────────────────────────
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function ask(question) {
  return new Promise(resolve => rl.question(question, answer => resolve(answer.trim())));
}
function askHidden(question) {
  return new Promise(resolve => {
    const stdin = process.stdin;
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const onData = (char) => {
      if (char === '\n' || char === '\r' || char === '\u0004') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(value);
        return;
      }
      if (char === '\u0003') process.exit(0); // Ctrl+C
      if (char === '\u007f') { value = value.slice(0, -1); return; } // backspace
      value += char;
    };
    stdin.on('data', onData);
  });
}

function log(msg) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${msg}`);
}

// ─── Keypair + signing (mirrors apply-validator-cli.js / heartbeat-daemon.js) ──
function keypairFromMnemonic(mnemonic) {
  const seed = bip39.mnemonicToSeedSync(mnemonic.trim());
  const { key } = derivePath(EAST_DERIVATION_PATH, seed.toString('hex'));
  return nacl.sign.keyPair.fromSeed(key);
}
function signMessage(mnemonic, message) {
  const kp = keypairFromMnemonic(mnemonic);
  const sig = nacl.sign.detached(Buffer.from(message, 'utf8'), kp.secretKey);
  return Buffer.from(sig).toString('hex');
}

// ─── Vault decryption (mirrors apply-validator-cli.js) ────────────────
function decryptFromVault(vault, password) {
  const salt = Buffer.from(vault.salt, 'hex');
  const key = crypto.scryptSync(password, salt, 32);
  const iv = Buffer.from(vault.iv, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(Buffer.from(vault.authTag, 'hex'));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(vault.ciphertext, 'hex')),
    decipher.final(),
  ]);
  return plain.toString('utf8');
}

// ─── Block math — MUST mirror src/lib/consensus/block-math.ts exactly ─
function computeSequenceHash(prevBlockHash, blockIndex, timestampMs) {
  const payload = `${prevBlockHash}|${blockIndex}|${timestampMs}`;
  return '0x' + crypto.createHash('sha256').update(payload).digest('hex');
}
function computeBlockHash(prevHash, blockIndex, merkleRoot, timestampMs, txCount) {
  const payload = `${prevHash}|${blockIndex}|${merkleRoot}|${timestampMs}|${txCount}`;
  return '0x' + crypto.createHash('sha256').update(payload).digest('hex');
}
function computeMerkleRoot(txHashes) {
  if (txHashes.length === 0) return '0x' + '0'.repeat(64);
  if (txHashes.length === 1) return txHashes[0];
  let layer = [...txHashes];
  while (layer.length > 1) {
    const next = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i];
      const right = layer[i + 1] || layer[i];
      next.push('0x' + crypto.createHash('sha256').update(left + right).digest('hex'));
    }
    layer = next;
  }
  return layer[0];
}
function buildProductionMessage(proposalId, blockIndex, blockHash) {
  return `BLOCK_PRODUCE|${proposalId}|${blockIndex}|${blockHash}`;
}

// ─── Heartbeat ─────────────────────────────────────────────────────
async function sendHeartbeat(apiUrl, telegramId, mnemonic) {
  const timestampMs = Date.now();
  const message = `HEARTBEAT|${telegramId}|${timestampMs}`;
  const signature = signMessage(mnemonic, message);

  try {
    const res = await fetch(`${apiUrl}/api/node/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegramId, timestampMs, signature }),
    });
    if (res.ok) {
      log(`✓ Heartbeat sent`);
      return true;
    }
    const text = await res.text();
    log(`⚠️  Heartbeat failed (HTTP ${res.status}): ${text}`);
    return false;
  } catch (err) {
    log(`✗ Heartbeat error: ${err.message}`);
    return false;
  }
}

// ─── Block production ──────────────────────────────────────────────
async function checkAndProduceBlock(apiUrl, telegramId, mnemonic) {
  let proposal;
  try {
    const res = await fetch(`${apiUrl}/api/consensus/my-proposal?telegramId=${encodeURIComponent(telegramId)}`);
    proposal = await res.json();
  } catch (err) {
    log(`✗ my-proposal poll error: ${err.message}`);
    return;
  }

  if (!proposal?.success || !proposal.pending) return; // not our turn — normal, stay quiet

  const { proposalId, blockIndex, prevHash, txHashes, isEmpty } = proposal;
  log(`⚡ Assigned leader for block #${blockIndex} (proposal #${proposalId}, ${txHashes.length} tx, empty=${isEmpty}) — producing...`);

  const timestampMs = Date.now();
  const merkleRoot = computeMerkleRoot(txHashes);
  const sequenceHash = computeSequenceHash(prevHash, blockIndex, timestampMs);
  const blockHash = computeBlockHash(prevHash, blockIndex, merkleRoot, timestampMs, txHashes.length);
  const signature = signMessage(mnemonic, buildProductionMessage(proposalId, blockIndex, blockHash));

  try {
    const res = await fetch(`${apiUrl}/api/consensus/submit-block`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        proposalId, telegramId,
        prevHash, merkleRoot, sequenceHash, blockHash, timestampMs, signature,
      }),
    });
    const body = await res.json();
    if (res.ok && body.success) {
      log(`✓ Block #${blockIndex} produced and accepted — hash ${blockHash.substring(0, 14)}...`);
    } else {
      log(`✗ Block #${blockIndex} REJECTED by server: ${body.error}`);
      log(`  (This means Vercel's recomputation didn't match what we sent — check clock sync and that this daemon's block-math matches block-math.ts exactly.)`);
    }
  } catch (err) {
    log(`✗ submit-block error: ${err.message}`);
  }
}

async function main() {
  const apiUrl = (process.env.EASTCHAIN_API_URL || await ask('URL API EastChain: ')).replace(/\/$/, '');
  const telegramId = process.env.EASTCHAIN_TELEGRAM_ID || await ask('Telegram ID Anda: ');
  const vaultPath = process.env.EASTCHAIN_VAULT_PATH || DEFAULT_VAULT_PATH;

  if (!fs.existsSync(vaultPath)) {
    console.error(`Vault file tidak ditemukan di ${vaultPath}.`);
    console.error('Jalankan apply-validator-cli.js dulu untuk membuat vault.');
    process.exit(1);
  }

  const password = await askHidden('Password vault: ');
  let mnemonic;
  try {
    const vault = JSON.parse(fs.readFileSync(vaultPath, 'utf8'));
    mnemonic = decryptFromVault(vault, password);
  } catch (err) {
    console.error('Gagal membuka vault — password salah atau file korup.');
    process.exit(1);
  }

  rl.close();

  log('=== EASTCHAIN Block Producer Daemon ===');
  log(`API: ${apiUrl}`);
  log(`Telegram ID: ${telegramId}`);
  log(`Heartbeat interval: ${HEARTBEAT_INTERVAL_MS / 1000}s | Proposal poll: ${POLL_PROPOSAL_INTERVAL_MS / 1000}s`);
  log('Tekan Ctrl+C untuk berhenti.\n');

  await sendHeartbeat(apiUrl, telegramId, mnemonic);
  const heartbeatTimer = setInterval(() => sendHeartbeat(apiUrl, telegramId, mnemonic), HEARTBEAT_INTERVAL_MS);
  const proposalTimer = setInterval(() => checkAndProduceBlock(apiUrl, telegramId, mnemonic), POLL_PROPOSAL_INTERVAL_MS);

  process.on('SIGINT', async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    log('\nMenerima SIGINT, mengirim heartbeat final sebelum keluar...');
    clearInterval(heartbeatTimer);
    clearInterval(proposalTimer);
    await sendHeartbeat(apiUrl, telegramId, mnemonic);
    log('Daemon berhenti.');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    clearInterval(heartbeatTimer);
    clearInterval(proposalTimer);
    log('Menerima SIGTERM, berhenti.');
    process.exit(0);
  });
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
