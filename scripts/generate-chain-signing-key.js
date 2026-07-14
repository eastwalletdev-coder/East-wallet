#!/usr/bin/env node
/**
 * EASTCHAIN — Generate the chain-signing keypair (run ONCE)
 *
 * secp256k1 / EVM-compatible: this keypair is used ONLY to sign block
 * headers so Light Nodes can verify a header actually came from Vercel's
 * sealBlock() — it is NOT a user wallet key, NOT a validator key, and
 * shares no derivation with KEYPAIR_DERIVATION_SECRET. Keep the private
 * key secret; the ADDRESS (not a raw public key) is meant to be embedded
 * in the client bundle.
 *
 * Usage: node scripts/generate-chain-signing-key.js
 */
const { Wallet } = require('ethers');

const wallet = Wallet.createRandom();

console.log('=== EASTCHAIN Chain Signing Keypair (secp256k1 / EVM-compatible) ===\n');
console.log('Set this on Vercel as a SERVER-ONLY env var (never expose it):');
console.log(`  CHAIN_SIGNING_PRIVATE_KEY=${wallet.privateKey}\n`);
console.log('Set this on Vercel as a PUBLIC env var (safe to expose, gets bundled into the client):');
console.log(`  NEXT_PUBLIC_CHAIN_SIGNING_ADDRESS=${wallet.address}\n`);
console.log('Also set once you know the current chain tip, so already-sealed');
console.log('unsigned blocks aren\'t rejected retroactively (set to current height + 1):');
console.log('  NEXT_PUBLIC_SIGNING_ENFORCED_FROM_HEIGHT=<current_tip + 1>\n');
console.log('Store the private key somewhere safe outside of this terminal output (password manager / secret vault).');
