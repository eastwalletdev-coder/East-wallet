"use client";

import { pushLocalActivity, listAllLocalActivity } from "@/lib/chain-activity-local";

/** Copy ledger "receive" rows into local activity so UI lists match send/stake style. */
export function mergeReceivesIntoLocalActivity(
  myAddress: string,
  txs: Array<{
    txHash: string;
    type: string;
    amount: string;
    address: string;
    status?: string;
  }>,
) {
  if (!myAddress || typeof window === "undefined") return;
  const me = myAddress.toLowerCase();
  const existing = new Set(listAllLocalActivity().map((x) => x.txHash));
  for (const tx of txs) {
    if (tx.type !== "receive") continue;
    if (!tx.txHash || existing.has(tx.txHash)) continue;
    const amt = String(tx.amount || "").replace(/^\+/, "").replace(/,/g, "");
    pushLocalActivity({
      type: "receive",
      token: "EAST",
      amount: amt,
      status: (tx.status as "confirmed" | "pending" | "failed") || "confirmed",
      address: tx.address || "",
      wallet: me,
      txHash: tx.txHash,
    });
    existing.add(tx.txHash);
  }
}
