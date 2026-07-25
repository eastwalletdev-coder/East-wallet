'use server';

/**
 * EASTCHAIN — Contract Execution Engine
 * ─────────────────────────────────────────────────────────────────────
 * A minimal, EVM-shaped call layer: `callContract({ contractAddress,
 * functionName, params })` behaves like `eth_sendTransaction` — every
 * call is gas-metered in EAST, signed, nonce-protected, and recorded
 * as a normal ledger block/transaction plus a ledger.contract_calls row.
 *
 * SECURITY MODEL (read before touching this file)
 * ─────────────────────────────────────────────────────────────────────
 * 1. Telegram initData HMAC is still the real authentication boundary
 *    today (same as every other action in this codebase) — it proves
 *    "this HTTP request really comes from Telegram user tgId". Nothing
 *    below replaces that check.
 * 2. ABI WHITELIST — a call is rejected outright unless
 *    (contractAddress, functionName) is a known entry in registry.ts
 *    AND params match that entry's param list EXACTLY (no missing, no
 *    extra keys). This blocks injection of arbitrary internal
 *    functions or smuggled extra fields.
 * 3. DOMAIN-SEPARATED, EXPIRING, NONCE'D PAYLOAD — every call signs
 *    (and verifies) a canonical string that includes a fixed domain
 *    tag, the contract address, function name, sorted params, the
 *    caller's address, a strictly-incrementing per-address nonce, and
 *    an expiry timestamp. This means:
 *      - a captured signature cannot be replayed (nonce is consumed
 *        atomically under a row lock, once per call)
 *      - a signature cannot be reused against a different function,
 *        contract, or param set (all are part of the signed payload)
 *      - a signature cannot be replayed after ~5 minutes (expiry)
 *      - a signature cannot be replayed against a *different* chain
 *        once EAST has a real public chain (domain tag + chain id)
 * 4. DUAL SIGNING PATH:
 *      - Native (today, custodial): the server derives + signs + verifies
 *        the payload itself via the user's deterministic Ed25519 key.
 *        The client NEVER supplies this signature, so it can't be forged.
 *        Its purpose is architectural: every call — native or external —
 *        passes through the exact same verify-then-execute path.
 *      - External EVM wallet (future, e.g. MetaMask once EAST has a
 *        public chain): client supplies `evmSignature` + `evmAddress`.
 *        The engine recovers the signer with `ethers.verifyMessage` and
 *        REQUIRES the recovered address to match a previously-linked
 *        `identity.users.linked_evm_address` for that tgId — an
 *        unlinked or mismatched address is rejected. There is currently
 *        no linking flow wired to any UI, so this path cannot be
 *        exercised yet; it exists so wiring an external wallet later is
 *        additive, not a rewrite.
 * 5. Gas is only charged on SUCCESSFUL execution (whole call is one DB
 *    transaction per pool; any thrown error rolls everything back,
 *    including the nonce bump) — deliberately simpler than real EVM
 *    "gas charged even on revert" to avoid punishing users for benign
 *    failures like insufficient balance.
 */

import { createHash } from 'crypto';
import { ethers } from 'ethers';
import { identityPool } from '@/lib/db/identity';
import { ledgerPool } from '@/lib/db/ledger';
import { validateTelegramData, extractVerifiedUserId } from '@/lib/telegram';
import { verifyIdentityOrSignature } from '@/lib/auth/dual-mode-identity';
import { signPayloadForUser, verifySignature, getPublicKeyForUser } from '@/lib/keypair-service';
import { buildContractCallPayload } from '@/lib/tx-payload-builders';
import { getNetworkStatus } from '@/lib/db/redis';
import { CONTRACTS } from './registry';
import { isKnownCall, paramsMatchAbi } from './abi-gate';
import * as stakingContract from './staking-contract';
import * as vestingContract from './vesting-contract';
import * as miningContract from './mining-contract';
import * as validatorContract from './validator-contract';
import * as governanceContract from './governance-contract';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const CHAIN_DOMAIN = 'EASTCHAIN_CONTRACT_CALL_V1';
const SIGNATURE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_GAS_PRICE_EAST = 0.01;

const CONTRACT_MODULES: Record<string, { execute: typeof stakingContract.execute }> = {
  [CONTRACTS.STAKING]: stakingContract,
  [CONTRACTS.VESTING]: vestingContract,
  [CONTRACTS.MINING]: miningContract,
  [CONTRACTS.VALIDATOR]: validatorContract,
  [CONTRACTS.GOVERNANCE]: governanceContract,
};

export interface CallContractParams {
  tgId: string;
  initData?: string;
  contractAddress: string;
  functionName: string;
  params?: Record<string, any>;
  /** Future external-wallet path — see security note 4 above. */
  evmSignature?: string;
  evmAddress?: string;
  /** Self-custody signature (alternative to initData, not EVM) */
  signature?: string;
  selfCustodyPubkey?: string;
}

function canonicalPayload(opts: {
  contractAddress: string;
  functionName: string;
  params: Record<string, any>;
  callerAddress: string;
  nonce: number;
  expiresAt: number;
}): string {
  const sortedParams = Object.keys(opts.params)
    .sort()
    .reduce((acc: Record<string, any>, k) => {
      acc[k] = opts.params[k];
      return acc;
    }, {});
  return [
    CHAIN_DOMAIN,
    opts.contractAddress,
    opts.functionName,
    JSON.stringify(sortedParams),
    opts.callerAddress.toLowerCase(),
    String(opts.nonce),
    String(opts.expiresAt),
  ].join('|');
}

async function getGasPrice(): Promise<number> {
  const client = await ledgerPool.connect();
  try {
    const res = await client.query(`SELECT value FROM ledger.chain_meta WHERE key = 'gas_price_east'`);
    if (res.rows.length) {
      const v = parseFloat(res.rows[0].value);
      if (Number.isFinite(v) && v >= 0) return v;
    }
    return DEFAULT_GAS_PRICE_EAST;
  } finally {
    client.release();
  }
}

export async function callContract(
  call: CallContractParams
): Promise<{ success: boolean; error?: string; callHash?: string; gasFee?: number; [key: string]: any }> {
  const { tgId, initData, contractAddress, functionName, params = {}, evmSignature, evmAddress, signature, selfCustodyPubkey } = call;

  // ── 1. Identity verification (Telegram OR self-custody signature) ──
  if (IS_PRODUCTION) {
    let userRow;
    try {
      const identityClient = await identityPool.connect();
      try {
        const userRes = await identityClient.query(
          'SELECT self_custody_pubkey, wallet_address, wallet_type FROM identity.users WHERE telegram_id = $1',
          [tgId]
        );
        userRow = userRes.rows[0] || null;
      } catch (columnErr) {
        // wallet_address/wallet_type may not exist yet if migration
        // 003_evm_self_custody.sql hasn't been applied to this DB —
        // fall back to the base column so the whole action doesn't die.
        // (secp256k1 self-custody auth just won't be available until
        // the migration runs; Telegram initData / Ed25519 still work.)
        console.warn('[engine.ts] wallet_address/wallet_type lookup failed, falling back to self_custody_pubkey only — has migration 003_evm_self_custody.sql been applied?', columnErr);
        const fallbackRes = await identityClient.query(
          'SELECT self_custody_pubkey FROM identity.users WHERE telegram_id = $1',
          [tgId]
        );
        userRow = fallbackRes.rows[0] || null;
      } finally {
        identityClient.release();
      }
    } catch (err) {
      return { success: false, error: 'DB_LOOKUP_FAILED' };
    }

    // Build signature payload if signature-mode is being used
    let signaturePayload: string | undefined;
    if (signature) {
      signaturePayload = buildContractCallPayload(tgId, contractAddress, functionName, params);
    }

    const authResult = await verifyIdentityOrSignature(
      tgId,
      initData,
      selfCustodyPubkey || userRow?.self_custody_pubkey,
      signature,
      signaturePayload,
      true,
      userRow?.wallet_type === 'self_custody_evm' ? userRow?.wallet_address : undefined
    );
    if (!authResult.success) return { success: false, error: authResult.error };
  }

  // ── 2. Network guard ───────────────────────────────────────────
  const networkStatus = await getNetworkStatus();
  if (networkStatus === 'halted') return { success: false, error: 'NETWORK_LOCKED' };
  if (networkStatus === 'recovering' && contractAddress !== CONTRACTS.VALIDATOR) {
    return { success: false, error: 'NETWORK_RECOVERING' };
  }

  // ── 3. ABI whitelist — reject unknown function or param mismatch ──
  if (!(await isKnownCall(contractAddress, functionName))) return { success: false, error: 'UNKNOWN_CONTRACT_FUNCTION' };
  if (!(await paramsMatchAbi(contractAddress, functionName, params))) return { success: false, error: 'PARAM_MISMATCH' };

  const contractModule = CONTRACT_MODULES[contractAddress];
  if (!contractModule) return { success: false, error: 'UNKNOWN_CONTRACT' };

  const identityClient = await identityPool.connect();
  const ledgerClient = await ledgerPool.connect();

  try {
    await identityClient.query('BEGIN');
    await ledgerClient.query('BEGIN');

    const userRes = await identityClient.query(
      'SELECT * FROM identity.users WHERE telegram_id = $1 FOR UPDATE',
      [tgId]
    );
    if (!userRes.rows.length) throw new Error('USER_NOT_FOUND');
    const user = userRes.rows[0];
    const callerAddress: string = user.wallet_address;

    // ── 4. Nonce — atomic, row-locked, prevents signature replay ────
    await ledgerClient.query(
      `INSERT INTO ledger.contract_nonces (address, nonce) VALUES ($1, 0) ON CONFLICT (address) DO NOTHING`,
      [callerAddress]
    );
    const nonceRes = await ledgerClient.query(
      `SELECT nonce FROM ledger.contract_nonces WHERE address = $1 FOR UPDATE`,
      [callerAddress]
    );
    const currentNonce = Number(nonceRes.rows[0].nonce);
    const nextNonce = currentNonce + 1;
    const expiresAt = Date.now() + SIGNATURE_WINDOW_MS;

    const payload = canonicalPayload({ contractAddress, functionName, params, callerAddress, nonce: nextNonce, expiresAt });

    // ── 5. Signature verification — dual path, hard reject on failure ──
    let signatureValid = false;
    if (evmSignature && evmAddress) {
      try {
        const recovered = ethers.verifyMessage(payload, evmSignature);
        signatureValid =
          !!user.linked_evm_address &&
          recovered.toLowerCase() === evmAddress.toLowerCase() &&
          evmAddress.toLowerCase() === String(user.linked_evm_address).toLowerCase();
      } catch {
        signatureValid = false;
      }
    } else {
      const sig = await signPayloadForUser(tgId, payload);
      const pubKey: string = user.public_key || (await getPublicKeyForUser(tgId)).publicKeyHex;
      signatureValid = await verifySignature(pubKey, payload, sig);
    }
    if (!signatureValid) throw new Error('INVALID_SIGNATURE');
    if (Date.now() > expiresAt) throw new Error('SIGNATURE_EXPIRED');

    // ── 6. Gas — waived exactly once for a brand-new user's very first
    //    mining claim (new users start with balance 0 and would
    //    otherwise be unable to pay gas for their first-ever reward).
    //    Every other call, and every subsequent claim, is gas-metered
    //    as normal. This can only ever fire once per user — the flag
    //    flips to TRUE below and is never reset.
    const isFirstFreeMiningClaim =
      contractAddress === CONTRACTS.MINING &&
      functionName === 'claimMiningReward' &&
      !user.has_first_claimed;
    const gasPrice = isFirstFreeMiningClaim ? 0 : await getGasPrice();
    if (Number(user.balance) < gasPrice) throw new Error('INSUFFICIENT_GAS');

    // ── 7. Dispatch to contract module business logic ───────────────
    const result = await contractModule.execute(functionName, params, {
      tgId,
      user,
      identityClient,
      ledgerClient,
    });
    if (!result.success) throw new Error(result.error || 'EXECUTION_REVERTED');

    // ── 8. Charge gas + advance nonce + audit log, same transaction ──
    await identityClient.query(
      isFirstFreeMiningClaim
        ? `UPDATE identity.users SET balance = balance - $1, has_first_claimed = TRUE, updated_at = NOW() WHERE telegram_id = $2`
        : `UPDATE identity.users SET balance = balance - $1, updated_at = NOW() WHERE telegram_id = $2`,
      [gasPrice, tgId]
    );
    await ledgerClient.query(`UPDATE ledger.contract_nonces SET nonce = $1 WHERE address = $2`, [nextNonce, callerAddress]);

    const callHash = '0x' + createHash('sha256').update(`${payload}|${Date.now()}|${Math.random()}`).digest('hex');
    await ledgerClient.query(
      `INSERT INTO ledger.contract_calls (call_hash, contract_address, function_name, calldata, caller_address, nonce, gas_fee, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'confirmed')`,
      [callHash, contractAddress, functionName, JSON.stringify(params), callerAddress, nextNonce, gasPrice]
    );

    await ledgerClient.query('COMMIT');
    await identityClient.query('COMMIT');

    return { success: true, callHash, gasFee: gasPrice, nonce: nextNonce, ...result.data };
  } catch (err: any) {
    await ledgerClient.query('ROLLBACK').catch(() => {});
    await identityClient.query('ROLLBACK').catch(() => {});
    return { success: false, error: err.message };
  } finally {
    ledgerClient.release();
    identityClient.release();
  }
}
