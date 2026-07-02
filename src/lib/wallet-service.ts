"use server"

import * as bip39 from 'bip39';
import { HDNodeWallet, Mnemonic } from 'ethers';
import { derivePath } from 'ed25519-hd-key';
import bs58 from 'bs58';
import nacl from 'tweetnacl';

/**
 * Server-side wallet service — BIP-44 standard derivation
 * EVM:    m/44'/60'/0'/0/0  (MetaMask compatible)
 * Solana: m/44'/501'/0'/0'  (Phantom compatible)
 */

export async function generateMnemonic(): Promise<string> {
  return bip39.generateMnemonic();
}

export async function validateMnemonic(mnemonic: string): Promise<boolean> {
  if (!mnemonic) return false;
  return bip39.validateMnemonic(mnemonic.trim());
}

export async function deriveAllAccounts(mnemonic: string) {
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
    {
      name: 'Main Ethereum',
      address: evmAddress,
      balance: '0.00 ETH',
      chain: 'Ethereum' as const,
    },
    {
      name: 'Base Vault',
      address: evmAddress, // EVM-compatible, same derivation path
      balance: '0.00 BASE',
      chain: 'Base' as const,
    },
    {
      name: 'BSC Node',
      address: evmAddress, // EVM-compatible, same derivation path
      balance: '0.00 BNB',
      chain: 'BSC' as const,
    },
    {
      name: 'Solana Storage',
      address: solAddress,
      balance: '0.00 SOL',
      chain: 'Solana' as const,
    },
  ];
}
