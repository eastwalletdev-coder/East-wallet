"use client"

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { generateMnemonic, validateMnemonic, deriveAllAccounts } from './wallet-service';
import { toast } from '@/hooks/use-toast';

/**
 * WalletProvider — AES-GCM encrypted localStorage
 * Mnemonic is encrypted with a password before being stored.
 * The password is never stored — it's only used as the encryption key.
 */

// ── Crypto Helpers ────────────────────────────────────────────────────────────

// Iteration count isn't stored inside the encrypted blob (only salt + IV
// are), so bumping it isn't just a one-line change — every vault already
// created under the old count would stop decrypting. CURRENT is used for
// all new encryptions; LEGACY is tried as a fallback on decrypt so existing
// vaults keep working, and gets silently upgraded to CURRENT right after.
const CURRENT_ITERATIONS = 600_000;
const LEGACY_ITERATIONS = 100_000;

async function deriveKey(password: string, salt: BufferSource, iterations: number): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptMnemonic(mnemonic: string, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, CURRENT_ITERATIONS);
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(mnemonic)
  );
  // Pack: salt(16) + iv(12) + ciphertext → base64
  const combined = new Uint8Array(16 + 12 + ciphertext.byteLength);
  combined.set(salt, 0);
  combined.set(iv, 16);
  combined.set(new Uint8Array(ciphertext), 28);
  return btoa(String.fromCharCode(...combined));
}

async function decryptMnemonicWith(encrypted: string, password: string, iterations: number): Promise<string> {
  const combined = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));
  const salt = combined.slice(0, 16);
  const iv = combined.slice(16, 28);
  const ciphertext = combined.slice(28);
  const key = await deriveKey(password, salt, iterations);
  const dec = new TextDecoder();
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return dec.decode(plain);
}

/**
 * Decrypts a vault blob, trying the current (strong) iteration count first
 * and falling back to the legacy count for vaults created before the PBKDF2
 * bump. AES-GCM's auth tag makes this safe — a wrong key throws instead of
 * silently returning garbage, so there's no ambiguity about which count is
 * right. Returns whether the legacy path was used, so callers can silently
 * re-encrypt (upgrade) the vault to the current iteration count right away.
 */
async function decryptMnemonic(encrypted: string, password: string): Promise<{ mnemonic: string; wasLegacy: boolean }> {
  try {
    const mnemonic = await decryptMnemonicWith(encrypted, password, CURRENT_ITERATIONS);
    return { mnemonic, wasLegacy: false };
  } catch {
    const mnemonic = await decryptMnemonicWith(encrypted, password, LEGACY_ITERATIONS);
    return { mnemonic, wasLegacy: true };
  }
}

/**
 * Standalone helper (outside the WalletProvider/useWallet hook) that reads the
 * local encrypted vault from localStorage and decrypts it with the given
 * password — returns the raw mnemonic. Unlike unlock(), this does NOT touch
 * any React state; it's meant for one-off reads (e.g. re-confirming the
 * mnemonic during a self-custody upgrade flow). Throws if there's no vault
 * or the password is wrong.
 */
export async function decryptVaultMnemonic(password: string): Promise<string> {
  const encrypted = localStorage.getItem('east_vault');
  if (!encrypted) throw new Error('No local wallet vault found on this device.');
  const { mnemonic, wasLegacy } = await decryptMnemonic(encrypted, password);
  if (wasLegacy) {
    try {
      localStorage.setItem('east_vault', await encryptMnemonic(mnemonic, password));
    } catch {
      // Non-fatal — worst case it just re-upgrades on the next unlock/tx.
    }
  }
  return mnemonic;
}

// ── Types ─────────────────────────────────────────────────────────────────────

type Account = {
  name: string;
  address: string;
  balance: string;
  chain: 'Ethereum' | 'Solana' | 'Base' | 'BSC';
};

type WalletContextType = {
  mnemonic: string | null;
  accounts: Account[];
  isLoading: boolean;
  isLocked: boolean;
  hasPassword: boolean;
  createWallet: (password: string, existingMnemonic?: string) => Promise<void>;
  importWallet: (phrase: string, password: string) => Promise<boolean>;
  logout: () => void;
  unlock: (password: string) => Promise<boolean>;
  lock: () => void;
};

const WalletContext = createContext<WalletContextType | undefined>(undefined);

// ── Provider ──────────────────────────────────────────────────────────────────

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLocked, setIsLocked] = useState(false);
  const [hasPassword, setHasPassword] = useState(false);

  const loadAccounts = useCallback(async (phrase: string) => {
    setIsLoading(true);
    try {
      const derived = await deriveAllAccounts(phrase);
      setAccounts(derived);
    } catch (error) {
      console.error('Failed to derive accounts', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // On mount — check if encrypted vault exists, set locked if yes
  useEffect(() => {
    const encrypted = localStorage.getItem('east_vault');
    if (encrypted) {
      setHasPassword(true);
      setIsLocked(true); // require unlock
    }
    setIsLoading(false);
  }, []);

  const createWallet = async (password: string, existingMnemonic?: string) => {
    try {
      setIsLoading(true);
      // If a mnemonic was already generated & shown to the user for backup
      // (e.g. from CreateWalletDialog's generate/backup step), use that exact
      // one — generating a NEW random one here would silently mismatch the
      // phrase the user just backed up against what's actually in the vault.
      const newMnemonic = existingMnemonic || await generateMnemonic();
      const encrypted = await encryptMnemonic(newMnemonic, password);
      localStorage.setItem('east_vault', encrypted);
      setMnemonic(newMnemonic);
      setHasPassword(true);
      setIsLocked(false);
      await loadAccounts(newMnemonic);
      toast({ title: 'Vault Created', description: 'Your secure multi-chain vault is ready.' });
    } catch {
      toast({ variant: 'destructive', title: 'Creation Failed', description: 'An error occurred while generating your vault.' });
      setIsLoading(false);
    }
  };

  const importWallet = async (phrase: string, password: string): Promise<boolean> => {
    setIsLoading(true);
    try {
      const isValid = await validateMnemonic(phrase);
      if (!isValid) return false;
      const encrypted = await encryptMnemonic(phrase, password);
      localStorage.setItem('east_vault', encrypted);
      setMnemonic(phrase);
      setHasPassword(true);
      setIsLocked(false);
      await loadAccounts(phrase);
      return true;
    } catch {
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const unlock = async (password: string): Promise<boolean> => {
    try {
      const encrypted = localStorage.getItem('east_vault');
      if (!encrypted) return false;
      const { mnemonic: phrase, wasLegacy } = await decryptMnemonic(encrypted, password);
      if (wasLegacy) {
        try { localStorage.setItem('east_vault', await encryptMnemonic(phrase, password)); }
        catch { /* non-fatal — retried on next unlock */ }
      }
      setMnemonic(phrase);
      setIsLocked(false);
      await loadAccounts(phrase);
      return true;
    } catch {
      // Wrong password — decryption will throw
      return false;
    }
  };

  const lock = () => {
    setMnemonic(null);
    setAccounts([]);
    setIsLocked(true);
  };

  const logout = () => {
    localStorage.removeItem('east_vault');
    setMnemonic(null);
    setAccounts([]);
    setHasPassword(false);
    setIsLocked(false);
    setIsLoading(false);
    toast({ title: 'Data Wiped', description: 'Local keys and secrets erased.' });
  };

  return (
    <WalletContext.Provider value={{
      mnemonic, accounts, isLoading, isLocked, hasPassword,
      createWallet, importWallet, logout, unlock, lock,
    }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) throw new Error('useWallet must be used within WalletProvider');
  return context;
}
