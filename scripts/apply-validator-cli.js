#!/usr/bin/env node
/**
 * EASTCHAIN — Validator application CLI
 * ─────────────────────────────────────────────────────────────────────
 * Run this on the machine you intend to actually validate FROM (VPS,
 * home server, laptop that stays on) — not on the phone running the
 * Telegram Mini App. It:
 *
 *   1. Generates a new EAST keypair (or imports an existing mnemonic —
 *      e.g. one you exported earlier from the custodial wallet).
 *   2. Signs the self-custody claim and registers your public key.
 *   3. Signs the validator-candidacy claim and submits your application
 *      (lands as 'pending_review' — an admin still has to approve it).
 *   4. Saves the mnemonic to an encrypted local file so
 *      scripts/heartbeat-daemon.js (or your own node process) can use it
 *      later WITHOUT re-entering it — the password only decrypts it,
 *      never leaves this machine, never gets sent anywhere.
 *
 * Usage:
 *   node scripts/apply-validator-cli.js
 *
 * Env vars (or you'll be prompted):
 *   EASTCHAIN_API_URL     e.g. https://your-app.vercel.app
 *   EASTCHAIN_TELEGRAM_ID your numeric Telegram ID
 *   EASTCHAIN_ADMIN_SECRET  (optional) same value as ADMIN_SECRET in
 *                            your Vercel env — lets this script skip
 *                            Telegram initData verification, since it
 *                            runs outside Telegram entirely. Only use
 *                            this if you control the server (i.e. this
 *                            is one of the project's own admins running
 *                            it for themselves — see the project's
 *                            "5 admins for now" phase discussed with the
 *                            team; drop this once outside candidates are
 *                            allowed).
 */

const readline = require('readline');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bip39 = require('bip39');
const { derivePath } = require('ed25519-hd-key');
const nacl = require('tweetnacl');

const EAST_DERIVATION_PATH = "m/44'/501'/0'/0'";
const VAULT_PATH = path.join(__dirname, '.eastchain-validator-vault.json');

// ─── Prompt helpers ─────────────────────────────────────────────────
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function ask(question) {
  return new Promise(resolve => rl.question(question, answer => resolve(answer.trim())));
}
function askHidden(question) {
  // Simple hidden input — masks with mute after the prompt is written.
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
      if (char === '\u0003') process.exit(1); // Ctrl+C
      if (char === '\u007f') { value = value.slice(0, -1); return; } // backspace
      value += char;
    };
    stdin.on('data', onData);
  });
}

// ─── Claim messages — MUST match src/lib/east-claim-messages.ts exactly ──
function buildSelfCustodyClaimMessage(telegramId, pubkeyHex) {
  return `SELF_CUSTODY_CLAIM|${telegramId}|${pubkeyHex}`;
}
function buildValidatorClaimMessage(telegramId, pubkeyHex) {
  return `REGISTER_VALIDATOR|${telegramId}|${pubkeyHex}`;
}

// ─── Keypair derivation — mirrors keypair-service.ts / east-self-custody.ts ──
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

// ─── Local encrypted vault (AES-256-GCM, scrypt-derived key) ─────────
function encryptToVault(mnemonic, password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(mnemonic, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
    ciphertext: ciphertext.toString('hex'),
  };
}
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

async function main() {
  console.log('=== EASTCHAIN Validator Application CLI ===\n');

  const apiUrl = (process.env.EASTCHAIN_API_URL || await ask('URL API EastChain (contoh https://app-kalian.vercel.app): ')).replace(/\/$/, '');
  const telegramId = process.env.EASTCHAIN_TELEGRAM_ID || await ask('Telegram ID Anda: ');
  const adminSecret = process.env.EASTCHAIN_ADMIN_SECRET || '';

  if (fs.existsSync(VAULT_PATH)) {
    console.log(`\nVault lokal sudah ada di ${VAULT_PATH}.`);
    const useExisting = (await ask('Pakai vault ini? (y/n): ')).toLowerCase() === 'y';
    if (useExisting) {
      const password = await askHidden('Password vault: ');
      const vault = JSON.parse(fs.readFileSync(VAULT_PATH, 'utf8'));
      let mnemonic;
      try {
        mnemonic = decryptFromVault(vault, password);
      } catch {
        console.error('Password salah atau vault korup.');
        process.exit(1);
      }
      await registerAndApply({ apiUrl, telegramId, mnemonic, adminSecret });
      rl.close();
      return;
    }
  }

  console.log('\nPilih sumber key:');
  console.log('  1) Import mnemonic yang sudah ada (misal dari export wallet lama)');
  console.log('  2) Generate mnemonic baru');
  const choice = await ask('Pilihan (1/2): ');

  let mnemonic;
  if (choice === '1') {
    mnemonic = await ask('Tempel 24 kata seed phrase: ');
    if (!bip39.validateMnemonic(mnemonic.trim())) {
      console.error('Seed phrase tidak valid.');
      process.exit(1);
    }
  } else {
    mnemonic = bip39.generateMnemonic(256);
    console.log('\n⚠️  SEED PHRASE BARU — CATAT DI TEMPAT AMAN, TIDAK AKAN DITAMPILKAN LAGI:\n');
    console.log(mnemonic);
    console.log('\nTekan Enter setelah Anda mencatatnya dengan aman.');
    await ask('');
  }

  const password = await askHidden('Buat password untuk mengenkripsi vault lokal (min. 8 karakter): ');
  if (password.length < 8) {
    console.error('Password terlalu pendek.');
    process.exit(1);
  }
  const vault = encryptToVault(mnemonic, password);
  fs.writeFileSync(VAULT_PATH, JSON.stringify(vault, null, 2), { mode: 0o600 });
  console.log(`\nVault tersimpan di ${VAULT_PATH} (chmod 600 — cuma bisa dibaca user ini).`);

  await registerAndApply({ apiUrl, telegramId, mnemonic, adminSecret });
  rl.close();
}

async function registerAndApply({ apiUrl, telegramId, mnemonic, adminSecret }) {
  const pubkeyHex = pubkeyHexFromMnemonic(mnemonic);
  console.log(`\nPublic key Anda: ${pubkeyHex}`);

  // ── Step 1: register self-custody ──────────────────────────────────
  console.log('\n[1/2] Mendaftarkan self-custody...');
  const claimMsg = buildSelfCustodyClaimMessage(telegramId, pubkeyHex);
  const claimSig = signMessage(mnemonic, claimMsg);

  const regRes = await postJson(`${apiUrl}/api/self-custody/register`, {
    telegramId, pubkeyHex, signatureHex: claimSig, adminSecret,
  }, adminSecret);
  if (!regRes.success) {
    console.error(`Gagal registrasi self-custody: ${regRes.error}`);
    process.exit(1);
  }
  console.log('✓ Self-custody terdaftar.');

  // ── Step 2: apply as validator candidate ───────────────────────────
  console.log('\n[2/2] Mengajukan sebagai calon validator...');
  const validatorMsg = buildValidatorClaimMessage(telegramId, pubkeyHex);
  const validatorSig = signMessage(mnemonic, validatorMsg);

  const applyRes = await postJson(`${apiUrl}/api/self-custody/apply-validator`, {
    telegramId, pubkeyHex, signatureHex: validatorSig, adminSecret,
  }, adminSecret);
  if (!applyRes.success) {
    console.error(`Gagal mengajukan validator: ${applyRes.error}`);
    process.exit(1);
  }
  console.log('✓ Pengajuan validator terkirim — status: pending_review.');
  console.log('\nLangkah selanjutnya: tunggu admin approve status Anda jadi validator aktif');
  console.log('(cek /api/consensus GET), baru setelah itu jalankan node heartbeat —');
  console.log('bilang saja kalau mau saya buatkan script heartbeat daemon-nya juga.');
}

async function postJson(url, body, adminSecret) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(adminSecret ? { 'x-cron-secret': adminSecret } : {}),
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
