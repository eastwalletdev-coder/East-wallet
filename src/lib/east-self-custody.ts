"use client";

/**
 * EASTCHAIN — Self-custody EAST key (client-only)
 * ─────────────────────────────────────────────────────────────────────
 * Everything in this file runs in the browser. Unlike keypair-service.ts
 * (which derives keys server-side from telegram_id + a server secret),
 * the private key here is generated/imported locally and encrypted with
 * a password the user chooses — the server never sees it, not even in
 * transit. Only the resulting PUBLIC key + signatures get sent out.
 *
 * Same derivation path as the server's custodial key (m/44'/501'/0'/0',
 * Ed25519/Solana-style) so an exported mnemonic from the old custodial
 * wallet can be imported here 1:1 — the address stays the same, balance
 * doesn't need to move. Generating a brand-new mnemonic instead is also
 * fine; registerSelfCustody() doesn't require it to match the old key.
 *
 * Storage: AES-GCM encrypted blob in localStorage, same scheme as
 * wallet-context.tsx, under a different key so the two vaults don't
 * collide (this one is EAST-native identity/signing, that one is the
 * multi-chain ETH/SOL/BSC portfolio wallet).
 */

import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

const EAST_DERIVATION_PATH = "m/44'/501'/0'/0'";
const VAULT_STORAGE_KEY = 'east_self_custody_vault';

// ── AES-GCM helpers (same scheme as wallet-context.tsx) ────────────────

async function deriveAesKey(password: string, salt: BufferSource): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptString(plain: string, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(password, salt);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain));
  const combined = new Uint8Array(16 + 12 + ciphertext.byteLength);
  combined.set(salt, 0);
  combined.set(iv, 16);
  combined.set(new Uint8Array(ciphertext), 28);
  return btoa(String.fromCharCode(...combined));
}

async function decryptString(encrypted: string, password: string): Promise<string> {
  const combined = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));
  const salt = combined.slice(0, 16);
  const iv = combined.slice(16, 28);
  const ciphertext = combined.slice(28);
  const key = await deriveAesKey(password, salt);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plain);
}

// ── Keypair derivation (mirrors keypair-service.ts on the server) ─────

function keypairFromMnemonic(mnemonic: string): nacl.SignKeyPair {
  const seed = bip39.mnemonicToSeedSync(mnemonic.trim());
  const { key } = derivePath(EAST_DERIVATION_PATH, seed.toString('hex'));
  return nacl.sign.keyPair.fromSeed(key);
}

export type SelfCustodyKeypair = {
  publicKeyHex: string;
  publicKeyBase58: string;
};

/** Generates a brand-new mnemonic (does not persist it — caller must vault it). */
export function generateNewMnemonic(): string {
  return bip39.generateMnemonic(256); // 24 words, matches server's entropy strength
}

export function isValidMnemonic(phrase: string): boolean {
  return bip39.validateMnemonic(phrase.trim());
}

export function publicKeyFromMnemonic(mnemonic: string): SelfCustodyKeypair {
  const kp = keypairFromMnemonic(mnemonic);
  return {
    publicKeyHex: Buffer.from(kp.publicKey).toString('hex'),
    publicKeyBase58: bs58.encode(Buffer.from(kp.publicKey)),
  };
}

/** Signs a payload string with the mnemonic's derived key. Returns hex signature. */
export function signWithMnemonic(mnemonic: string, payload: string): string {
  const kp = keypairFromMnemonic(mnemonic);
  const message = new TextEncoder().encode(payload);
  const signature = nacl.sign.detached(message, kp.secretKey);
  return Buffer.from(signature).toString('hex');
}

// ── Local encrypted vault (localStorage) ───────────────────────────────

export function hasLocalVault(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(VAULT_STORAGE_KEY) !== null;
}

export async function saveMnemonicToVault(mnemonic: string, password: string): Promise<void> {
  const encrypted = await encryptString(mnemonic, password);
  localStorage.setItem(VAULT_STORAGE_KEY, encrypted);
}

export async function loadMnemonicFromVault(password: string): Promise<string> {
  const encrypted = localStorage.getItem(VAULT_STORAGE_KEY);
  if (!encrypted) throw new Error('No local self-custody vault found');
  return decryptString(encrypted, password);
}

export function clearLocalVault(): void {
  localStorage.removeItem(VAULT_STORAGE_KEY);
}
