"use client"

/**
 * EASTCHAIN — Multi-chain wallet derivation (client-only)
 * ─────────────────────────────────────────────────────────────────────
 * FIXED A CRITICAL SECURITY BUG: this file previously had "use server"
 * at the top, meaning every createWallet()/importWallet()/unlock() call
 * sent the PLAINTEXT mnemonic over the network to a Server Action —
 * completely undermining the self-custody promise (see the file header
 * in wallet-context.tsx: "the password is never stored"... but the
 * mnemonic itself WAS leaving the device). Same pattern/precedent as
 * east-self-custody.ts, which already does this correctly client-side.
 *
 * Everything here runs in the browser. bip39/ethers/ed25519-hd-key/bs58/
 * tweetnacl are all pure JS and work fine client-side — there was no
 * technical reason for this to be a Server Action.
 *
 * BIP-44 standard derivation:
 *   EVM:    m/44'/60'/0'/0/0  (MetaMask compatible)
 *   Solana: m/44'/501'/0'/0'  (Phantom compatible)
 */
import * as bip39 from 'bip39';
import { HDNodeWallet, Mnemonic, JsonRpcProvider, type Wallet } from 'ethers';
import { derivePath } from 'ed25519-hd-key';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { Keypair } from '@solana/web3.js';

export function generateMnemonic(): string {
  return bip39.generateMnemonic();
}

export function validateMnemonic(mnemonic: string): boolean {
  if (!mnemonic) return false;
  return bip39.validateMnemonic(mnemonic.trim());
}

export function deriveAllAccounts(mnemonic: string) {
  if (!mnemonic || !bip39.validateMnemonic(mnemonic.trim())) {
    throw new Error('Invalid mnemonic');
  }

  const phrase = mnemonic.trim();

  // ── EVM Derivation (m/44'/60'/0'/0/0) ──────────────────────────────
  const mnemonicObj = Mnemonic.fromPhrase(phrase);
  const evmWallet = HDNodeWallet.fromMnemonic(mnemonicObj, "m/44'/60'/0'/0/0");
  const evmAddress = evmWallet.address; // checksummed 0x address

  // ── Solana Derivation (m/44'/501'/0'/0') ───────────────────────────
  const seed = bip39.mnemonicToSeedSync(phrase);
  const { key } = derivePath("m/44'/501'/0'/0'", seed.toString('hex'));
  const keyPair = nacl.sign.keyPair.fromSeed(key);
  const solAddress = bs58.encode(Buffer.from(keyPair.publicKey));

  return [
    { name: 'Main Ethereum', address: evmAddress, balance: '0.00 ETH', chain: 'Ethereum' as const },
    { name: 'Base Vault', address: evmAddress, balance: '0.00 BASE', chain: 'Base' as const },
    { name: 'BSC Node', address: evmAddress, balance: '0.00 BNB', chain: 'BSC' as const },
    { name: 'Solana Storage', address: solAddress, balance: '0.00 SOL', chain: 'Solana' as const },
  ];
}

/**
 * Derives the EVM address + public key from a mnemonic — no RPC/network
 * needed, pure local derivation. Same path as deriveAllAccounts()/
 * getEvmSigner(), so the address always matches what's shown in the Wallet tab.
 */
export function getEvmIdentity(mnemonic: string): { address: string; publicKey: string } {
  const mnemonicObj = Mnemonic.fromPhrase(mnemonic.trim());
  const hdWallet = HDNodeWallet.fromMnemonic(mnemonicObj, "m/44'/60'/0'/0/0");
  return { address: hdWallet.address, publicKey: hdWallet.publicKey };
}

/**
 * Signs a plain-text payload with EIP-191 personal_sign — the exact scheme
 * verifyEvmOwnership() in evm-signature.ts expects (ethers.verifyMessage is
 * the matching verification counterpart to HDNodeWallet.signMessage).
 */
export async function signEvmMessage(mnemonic: string, payload: string): Promise<string> {
  const mnemonicObj = Mnemonic.fromPhrase(mnemonic.trim());
  const hdWallet = HDNodeWallet.fromMnemonic(mnemonicObj, "m/44'/60'/0'/0/0");
  return hdWallet.signMessage(payload);
}

/**
 * Returns a live ethers.Wallet (signer) connected to the given RPC —
 * used to actually sign + broadcast EVM transactions. Same derivation
 * path as deriveAllAccounts(), so the address matches exactly.
 */
export function getEvmSigner(mnemonic: string, rpcUrl: string): Wallet {
  const mnemonicObj = Mnemonic.fromPhrase(mnemonic.trim());
  const hdWallet = HDNodeWallet.fromMnemonic(mnemonicObj, "m/44'/60'/0'/0/0");
  const provider = new JsonRpcProvider(rpcUrl);
  return hdWallet.connect(provider) as unknown as Wallet;
}

/**
 * Returns a Solana Keypair for signing — @solana/web3.js accepts the
 * exact same 64-byte Ed25519 secret key format tweetnacl produces, so
 * this is a direct conversion, not a re-derivation.
 */
export function getSolanaKeypair(mnemonic: string): Keypair {
  const seed = bip39.mnemonicToSeedSync(mnemonic.trim());
  const { key } = derivePath("m/44'/501'/0'/0'", seed.toString('hex'));
  const keyPair = nacl.sign.keyPair.fromSeed(key);
  return Keypair.fromSecretKey(keyPair.secretKey);
}
