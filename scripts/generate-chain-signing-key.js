#!/usr/bin/env node
/**
 * EASTCHAIN — Generate the chain-signing keypair (run ONCE)
 *
 * This keypair is used ONLY to sign block headers so Light Nodes can
 * verify a header actually came from Vercel's sealBlock() — it is NOT a
 * user wallet key, NOT a validator key, and shares no derivation with
 * KEYPAIR_DERIVATION_SECRET. Keep the private key secret; the public key
 * is meant to be embedded in the client bundle.
 *
 * Usage: node scripts/generate-chain-signing-key.js
 */
const nacl = require('tweetnacl');

const kp = nacl.sign.keyPair();
const privateSeedHex = Buffer.from(kp.secretKey.slice(0, 32)).toString('hex');
const publicKeyHex = Buffer.from(kp.publicKey).toString('hex');

console.log('=== EASTCHAIN Chain Signing Keypair ===\n');
console.log('Set this on Vercel as a SERVER-ONLY env var (never expose it):');
console.log(`  CHAIN_SIGNING_PRIVATE_KEY=${privateSeedHex}\n`);
console.log('Set this on Vercel as a PUBLIC env var (safe to expose, gets bundled into the client):');
console.log(`  NEXT_PUBLIC_CHAIN_SIGNING_PUBLIC_KEY=${publicKeyHex}\n`);
console.log('Store the private key somewhere safe outside of this terminal output (password manager / secret vault).');
