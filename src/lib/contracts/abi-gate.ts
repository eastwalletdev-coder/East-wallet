/**
 * EASTCHAIN — ABI Whitelist Gate (SERVER-ONLY)
 * ─────────────────────────────────────────────────────────────────────
 * isKnownCall()/paramsMatchAbi() check the static CONTRACT_ABI (registry.ts)
 * first, then fall back to identity.approved_contract_functions (populated
 * by governance-contract.ts once a validator quorum approves a new
 * function — see that file for the propose/vote flow).
 *
 * Deliberately split out of registry.ts: this file imports identityPool
 * ('pg' driver, Node-only), so importing it from a client component would
 * break the browser build (exactly what happened when isKnownCall lived in
 * registry.ts — 'fs'/'dns'/'net'/'tls' module-not-found errors, because
 * WalletConnectRequestHandler.tsx imports registry.ts too, just for the
 * EAST_CHAIN_ID constant). Only engine.ts (server-only) should import from
 * here.
 */
import { identityPool } from '@/lib/db/identity';
import { CONTRACT_ABI } from './registry';

export async function isKnownCall(contractAddress: string, functionName: string): Promise<boolean> {
  const abi = CONTRACT_ABI[contractAddress];
  if (abi && functionName in abi) return true;
  // Tier 2 — governance-approved functions (see module doc comment above).
  const res = await identityPool.query(
    'SELECT 1 FROM identity.approved_contract_functions WHERE contract_address = $1 AND function_name = $2',
    [contractAddress, functionName]
  );
  return res.rows.length > 0;
}

export async function paramsMatchAbi(
  contractAddress: string,
  functionName: string,
  params: Record<string, any>
): Promise<boolean> {
  let expected = CONTRACT_ABI[contractAddress]?.[functionName];
  if (!expected) {
    const res = await identityPool.query(
      'SELECT param_keys FROM identity.approved_contract_functions WHERE contract_address = $1 AND function_name = $2',
      [contractAddress, functionName]
    );
    if (!res.rows.length) return false;
    expected = res.rows[0].param_keys as string[]; // JSONB — pg already parses this to a JS array
  }
  const given = Object.keys(params);
  if (given.length !== expected.length) return false;
  return expected.every((k) => given.includes(k));
}
