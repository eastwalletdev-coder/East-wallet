"use client";

/**
 * Browser-side: build + sign + submit EAST chain txs via /api/chain/tx
 * (Vercel proxies to Railway Hub /rpc/tx → east-validator).
 */

import { signEvmMessage, getEvmIdentity } from "@/lib/wallet-service";
import {
  buildChainTxHashable,
  hashChainTxPayload,
  buildEastchainTxMessage,
  humanEastToSubunits,
  useChainTxEnabled,
  type ChainTxType,
  type ChainTxBody,
} from "@/lib/chain-tx";

export { useChainTxEnabled };

export type SubmitChainTxResult =
  | {
      success: true;
      txHash: string;
      status: string;
      via?: string;
      raw?: unknown;
    }
  | {
      success: false;
      error: string;
      detail?: unknown;
    };

async function fetchChainNonce(fromAddress: string): Promise<number> {
  const res = await fetch(
    `/api/chain/balance?address=${encodeURIComponent(fromAddress)}`,
    { cache: "no-store" },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error || `nonce_fetch_failed_${res.status}`,
    );
  }
  const data = (await res.json()) as { ok?: boolean; nonce?: number };
  if (!data.ok) throw new Error("nonce_fetch_failed");
  // Validator stores last-used nonce; next tx must be current+1 (or 1 if 0)
  const current = Number(data.nonce ?? 0) || 0;
  return current + 1;
}

export async function buildAndSignChainTx(params: {
  mnemonic: string;
  type: ChainTxType;
  /** Human EAST for transfer/stake (converted to subunits). claim_mining stays human. */
  amountHuman: number;
  toAddress?: string;
  /** Override nonce; if omitted, fetched from chain via /api/chain/balance */
  nonce?: number;
  payload?: unknown;
}): Promise<{ body: ChainTxBody; txHash: string; message: string }> {
  const { address: from } = getEvmIdentity(params.mnemonic);
  const fromLower = from.toLowerCase();
  const to =
    params.type === "transfer"
      ? (params.toAddress || "").trim().toLowerCase()
      : "";

  if (params.type === "transfer" && !to.startsWith("0x")) {
    throw new Error("recipient address required");
  }
  if (params.amountHuman <= 0) throw new Error("amount must be > 0");

  const amount =
    params.type === "claim_mining"
      ? Math.trunc(params.amountHuman)
      : humanEastToSubunits(params.amountHuman);

  const nonce =
    params.nonce !== undefined ? params.nonce : await fetchChainNonce(fromLower);
  const timestamp = Date.now();

  const hashableJson = buildChainTxHashable({
    type: params.type,
    from: fromLower,
    to,
    amount,
    nonce,
    timestamp,
  });
  const txHash = await hashChainTxPayload(hashableJson);
  const message = buildEastchainTxMessage(txHash);
  const signature = await signEvmMessage(params.mnemonic, message);

  const body: ChainTxBody = {
    type: params.type,
    from: fromLower,
    to,
    amount,
    nonce,
    timestamp,
    signature,
    ...(params.payload !== undefined ? { payload: params.payload } : {}),
  };

  return { body, txHash, message };
}

/**
 * Sign + POST transfer/stake/… to /api/chain/tx (Hub → validator).
 */
export async function submitChainTx(params: {
  mnemonic: string;
  type: ChainTxType;
  amountHuman: number;
  toAddress?: string;
  nonce?: number;
  payload?: unknown;
}): Promise<SubmitChainTxResult> {
  try {
    const { body, txHash } = await buildAndSignChainTx(params);

    const res = await fetch("/api/chain/tx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      txHash?: string;
      status?: string;
      via?: string;
      detail?: unknown;
    };

    if (!res.ok || !data.ok) {
      const detailMsg =
        typeof data.detail === "string"
          ? data.detail
          : data.detail
            ? JSON.stringify(data.detail).slice(0, 300)
            : "";
      return {
        success: false,
        error: data.error || `http_${res.status}`,
        detail: detailMsg || data.detail,
      };
    }

    return {
      success: true,
      txHash: data.txHash || txHash,
      status: data.status || "queued",
      via: data.via,
      raw: data,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/** Convenience: send EAST on-chain (transfer). */
export async function submitChainTransfer(
  mnemonic: string,
  toAddress: string,
  amountHuman: number,
): Promise<SubmitChainTxResult> {
  return submitChainTx({
    mnemonic,
    type: "transfer",
    amountHuman,
    toAddress,
  });
}

/** Convenience: stake EAST on-chain. */
export async function submitChainStake(
  mnemonic: string,
  amountHuman: number,
): Promise<SubmitChainTxResult> {
  return submitChainTx({
    mnemonic,
    type: "stake",
    amountHuman,
  });
}
