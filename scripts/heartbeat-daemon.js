#!/usr/bin/env node
/**
 * EASTCHAIN — Validator Heartbeat Daemon
 * ─────────────────────────────────────────────────────────────────────
 * Run this on the SAME machine where you ran scripts/apply-validator-cli.js
 * (the one that has .eastchain-validator-vault.json). This daemon:
 *
 *   - Reads the encrypted vault once at startup (prompt for password).
 *   - Runs forever, sending heartbeat pings every 30 seconds to prove
 *     this node is live and ready to validate.
 *   - Each ping is signed with your self-custody key (proof you can sign).
 *   - Server responds with 200 if you're an active validator; 403 if not
 *     (meaning you're not in top-N by PoC score yet, or not approved as
 *     a candidate, or something else — check logs).
 *
 * REQUIREMENTS:
 *   - Must run on a machine with stable internet + uptime (VPS recommended).
 *   - Port doesn't matter (this is outbound HTTP POST only).
 *   - Vault file must exist (.eastchain-validator-vault.json, created
 *     by apply-validator-cli.js).
 *   - Must match Telegram ID + API URL you used in the CLI.
 *
 * Usage:
 *   node scripts/heartbeat-daemon.js
 *
 * Env vars (or prompted at startup):
 *   EASTCHAIN_API_URL       API endpoint
 *   EASTCHAIN_TELEGRAM_ID   Your Telegram ID
 *   EASTCHAIN_VAULT_PATH    Path to vault file (default: .eastchain-validator-vault.json in script dir)
 *
 * Graceful shutdown: Ctrl+C — logs final heartbeat + exits cleanly.
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
const HEARTBEAT_INTERVAL_MS = 30_000; // 30s — must be < 90s (HEARTBEAT_FRESHNESS_SECONDS)

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

// ─── Keypair + signing (mirrors apply-validator-cli.js) ──────────────
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
      log(`✓ Heartbeat sent (HTTP ${res.status})`);
      return true;
    }

    const text = await res.text();
    if (res.status === 403) {
      log(`⚠️  Heartbeat rejected (HTTP 403) — you may not be an active validator yet.`);
      log(`    Response: ${text}`);
    } else {
      log(`✗ Heartbeat failed (HTTP ${res.status}): ${text}`);
    }
    return false;
  } catch (err) {
    log(`✗ Heartbeat error: ${err.message}`);
    return false;
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

  log('=== EASTCHAIN Validator Heartbeat Daemon ===');
  log(`API: ${apiUrl}`);
  log(`Telegram ID: ${telegramId}`);
  log(`Interval: ${HEARTBEAT_INTERVAL_MS / 1000}s`);
  log('Tekan Ctrl+C untuk berhenti.\n');

  // Send first heartbeat immediately
  await sendHeartbeat(apiUrl, telegramId, mnemonic);

  // Then schedule recurring heartbeats
  const intervalId = setInterval(async () => {
    await sendHeartbeat(apiUrl, telegramId, mnemonic);
  }, HEARTBEAT_INTERVAL_MS);

  // Graceful shutdown
  process.on('SIGINT', async () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    log('\nMenerima SIGINT, mengirim heartbeat final sebelum keluar...');
    clearInterval(intervalId);
    await sendHeartbeat(apiUrl, telegramId, mnemonic);
    log('Daemon berhenti.');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    clearInterval(intervalId);
    log('Menerima SIGTERM, berhenti.');
    process.exit(0);
  });
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
