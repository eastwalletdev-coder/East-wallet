'use server';

/**
 * EASTCHAIN — Keypair Service (BIP-39 / BIP-44)
 * ─────────────────────────────────────────────────────────────────────
 * Every user gets a real, standards-compliant HD wallet:
 *   1. A 24-word BIP-39 mnemonic is derived deterministically from their
 *      telegram_id + a server secret (HMAC-SHA256 → 32 bytes entropy).
 *   2. From that mnemonic we derive:
 *        - EAST/Solana-style key:  m/44'/501'/0'/0'   (Ed25519, SLIP-0010)
 *        - Bonus EVM key:          m/44'/60'/0'/0/0   (secp256k1)
 *
 * "Deterministic" here means: nothing secret is stored in the database.
 * The mnemonic/private key can always be re-derived server-side from
 * (telegram_id + KEYPAIR_DERIVATION_SECRET). That's what makes it trivial
 * to backfill keypairs for users who existed before this system did.
 *
 * ⚠️ SECURITY NOTE — read before wiring this into a UI:
 * Because keys are derived from a server-held secret rather than
 * generated client-side and thrown away, this is a CUSTODIAL model —
 * your server can always reconstruct any user's private key. That's
 * fundamentally different from "self-custody" wallets like MetaMask/
 * Phantom, even though the exported mnemonic will happily import into
 * those apps. If you bill this to users as "your keys, your crypto",
 * say so accurately: the mnemonic they import elsewhere becomes theirs
 * once exported, but your server retains the ability to derive it too
 * unless you rotate KEYPAIR_DERIVATION_SECRET and stop persisting it.
 * Anyone who obtains KEYPAIR_DERIVATION_SECRET + a user's telegram_id
 * can derive that user's private key — treat the secret like a master
 * key, not a config value (secret manager, not committed .env).
 */

import { createHmac } from 'crypto';
import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';
import { HDNodeWallet, Mnemonic } from 'ethers';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

const DERIVATION_SECRET =
  process.env.KEYPAIR_DERIVATION_SECRET || process.env.WALLET_ADDRESS_SALT || 'east_chain_salt_2025';

const EAST_DERIVATION_PATH = "m/44'/501'/0'/0'"; // Ed25519 — Solana/Phantom-compatible
const EVM_DERIVATION_PATH = "m/44'/60'/0'/0/0"; // secp256k1 — MetaMask-compatible

export interface EastPublicKey {
  publicKeyHex: string;
  publicKeyBase58: string;
}

export interface EastWalletExport {
  mnemonic: string;
  derivationPath: string;
  privateKeyHex: string;
  privateKeyBase58: string;
  publicKeyHex: string;
  publicKeyBase58: string;
  evm: {
    derivationPath: string;
    address: string;
    privateKeyHex: string;
  };
}

// 32 bytes of deterministic entropy for this user, from HMAC-SHA256(secret, userId)
function deriveEntropy(userId: string): Buffer {
  return createHmac('sha256', DERIVATION_SECRET)
    .update(`EASTCHAIN_MNEMONIC_${userId}`)
    .digest(); // 32 bytes -> valid BIP-39 entropy (256 bits = 24 words)
}

/**
 * Deterministic 24-word BIP-39 mnemonic for a user. Same userId always
 * produces the same mnemonic — nothing is stored to make this work.
 */
export async function deriveMnemonicForUser(userId: string): Promise<string> {
  return bip39.entropyToMnemonic(deriveEntropy(userId));
}

// Full Ed25519 keypair for the EAST/Solana-style account.
function deriveEastKeypairFromMnemonic(mnemonic: string) {
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  const { key } = derivePath(EAST_DERIVATION_PATH, seed.toString('hex'));
  return nacl.sign.keyPair.fromSeed(key);
}

/**
 * Public key for a user — safe to store in DB / send to client.
 */
export async function getPublicKeyForUser(userId: string): Promise<EastPublicKey> {
  const mnemonic = await deriveMnemonicForUser(userId);
  const kp = deriveEastKeypairFromMnemonic(mnemonic);
  return {
    publicKeyHex: Buffer.from(kp.publicKey).toString('hex'),
    publicKeyBase58: bs58.encode(Buffer.from(kp.publicKey)),
  };
}

/**
 * Sign an arbitrary payload (e.g. a canonical tx string) on behalf of a user.
 * Keys are derived in-memory and discarded immediately after use.
 */
export async function signPayloadForUser(userId: string, payload: string): Promise<string> {
  const mnemonic = await deriveMnemonicForUser(userId);
  const kp = deriveEastKeypairFromMnemonic(mnemonic);
  const message = new TextEncoder().encode(payload);
  const signature = nacl.sign.detached(message, kp.secretKey);
  return Buffer.from(signature).toString('hex');
}

/**
 * Verify a signature against a known public key (hex).
 */
export async function verifySignature(
  publicKeyHex: string,
  payload: string,
  signatureHex: string
): Promise<boolean> {
  try {
    const publicKey = new Uint8Array(Buffer.from(publicKeyHex, 'hex'));
    const message = new TextEncoder().encode(payload);
    const signature = new Uint8Array(Buffer.from(signatureHex, 'hex'));
    return nacl.sign.detached.verify(message, signature, publicKey);
  } catch {
    return false;
  }
}

/**
 * Full wallet export: mnemonic + private keys, ready to paste into
 * Phantom (Solana) or MetaMask (EVM). EXTREMELY SENSITIVE.
 *
 * Callers MUST authenticate the request (verify the caller really is
 * this userId) before invoking this — see wallet-export-actions.ts.
 * Never log the return value.
 */
export async function exportWalletForUser(userId: string): Promise<EastWalletExport> {
  const mnemonic = await deriveMnemonicForUser(userId);
  const kp = deriveEastKeypairFromMnemonic(mnemonic);

  const mnemonicObj = Mnemonic.fromPhrase(mnemonic);
  const evmWallet = HDNodeWallet.fromMnemonic(mnemonicObj, EVM_DERIVATION_PATH);

  return {
    mnemonic,
    derivationPath: EAST_DERIVATION_PATH,
    privateKeyHex: Buffer.from(kp.secretKey).toString('hex'), // 64 bytes: seed+pubkey (nacl "secretKey" format)
    privateKeyBase58: bs58.encode(Buffer.from(kp.secretKey)),
    publicKeyHex: Buffer.from(kp.publicKey).toString('hex'),
    publicKeyBase58: bs58.encode(Buffer.from(kp.publicKey)),
    evm: {
      derivationPath: EVM_DERIVATION_PATH,
      address: evmWallet.address,
      privateKeyHex: evmWallet.privateKey,
    },
  };
}

/**
 * Canonical transaction signing payload builder now lives in
 * tx-signing.ts (this file is 'use server', and 'use server' modules
 * may only export async functions — see Next.js Server Actions rules).
 */
