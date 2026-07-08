#!/usr/bin/env node
/**
 * EASTCHAIN — Example: Send EAST via Signature (Not from Telegram Mini App)
 * ─────────────────────────────────────────────────────────────────────────
 * This script demonstrates how to:
 * 1. Recover a self-custody keypair from vault
 * 2. Build the exact transaction payload server expects
 * 3. Sign it with your private key
 * 4. Send signed transaction to server
 *
 * Prereq: ran scripts/apply-validator-cli.js so vault exists locally.
 *
 * Usage:
 *   EASTCHAIN_API_URL=https://... \
 *   EASTCHAIN_TELEGRAM_ID=123456789 \
 *   EASTCHAIN_VAULT_PATH=.../.eastchain-validator-vault.json \
 *   node example-send-east-signature.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bip39 = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const nacl = require('tweetnacl');

const EAST_DERIVATION_PATH = "m/44'/501'/0'/0'";

// ─── Keypair helpers (same as apply-validator-cli.js) ──────────────
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

function pubkeyHexFromMnemonic(mnemonic) {
  const kp = keypairFromMnemonic(mnemonic);
  return Buffer.from(kp.publicKey).toString('hex');
}

// ─── Vault decryption ────────────────────────────────────────────────
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

// ─── Transaction payload builders (MUST match server side!) ──────────
function buildSendEastPayload(telegramId, recipientAddress, amount) {
  return `SEND_EAST|${telegramId}|${recipientAddress.toLowerCase()}|${amount}`;
}

async function main() {
  const apiUrl = process.env.EASTCHAIN_API_URL || 'http://localhost:3000';
  const telegramId = process.env.EASTCHAIN_TELEGRAM_ID;
  const vaultPath = process.env.EASTCHAIN_VAULT_PATH || '.eastchain-validator-vault.json';

  if (!telegramId) {
    console.error('EASTCHAIN_TELEGRAM_ID env var required');
    process.exit(1);
  }

  if (!fs.existsSync(vaultPath)) {
    console.error(`Vault file not found at ${vaultPath}`);
    console.error('Run scripts/apply-validator-cli.js first.');
    process.exit(1);
  }

  // For demo, use hardcoded password — in real use, prompt or env var
  const password = process.env.EASTCHAIN_VAULT_PASSWORD || 'password123';
  console.log('Unlocking vault...');

  let mnemonic;
  try {
    const vault = JSON.parse(fs.readFileSync(vaultPath, 'utf8'));
    mnemonic = decryptFromVault(vault, password);
  } catch (err) {
    console.error('Failed to decrypt vault — password wrong or file corrupt.');
    process.exit(1);
  }

  const pubkeyHex = pubkeyHexFromMnemonic(mnemonic);
  console.log(`Public key: ${pubkeyHex}`);

  // ─── Build and sign transaction ──────────────────────────────────
  const recipientAddress = '0x' + 'ab'.repeat(20); // dummy recipient
  const amount = 10;

  const payload = buildSendEastPayload(telegramId, recipientAddress, amount);
  console.log(`\nTransaction payload: ${payload}`);

  const signature = signMessage(mnemonic, payload);
  console.log(`Signature: ${signature}`);

  // ─── Send to server ─────────────────────────────────────────────
  console.log(`\nSending to ${apiUrl}/actions/sendEast...`);

  const body = {
    senderTgId: telegramId,
    recipientAddress,
    amount,
    signature,
    selfCustodyPubkey: pubkeyHex,
    // Note: NO initData — this is signature-mode, not Telegram
  };

  try {
    const res = await fetch(`${apiUrl}/actions/sendEast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const result = await res.json();
      console.log('\n✓ Transaction successful!');
      console.log(JSON.stringify(result, null, 2));
    } else {
      const error = await res.text();
      console.error(`\n✗ Transaction failed (HTTP ${res.status}):`);
      console.error(error);
    }
  } catch (err) {
    console.error(`\n✗ Network error: ${err.message}`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
