import { NextRequest, NextResponse } from "next/server";
import {
  chainReadConfigured,
  fetchChainAccount,
  useChainBalanceEnabled,
} from "@/lib/chain-balance";

/**
 * GET /api/chain/balance?address=0x...
 * Phase 3: public read of on-chain EAST balance (via Hub or validator).
 * Does not touch Neon.
 */
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address") || "";
  if (!address.startsWith("0x") || address.length < 10) {
    return NextResponse.json(
      { ok: false, error: "address required (0x...)" },
      { status: 400 },
    );
  }

  if (!chainReadConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error: "chain read not configured — set RAILWAY_HUB_URL and/or EAST_VALIDATOR_URL",
      },
      { status: 503 },
    );
  }

  const account = await fetchChainAccount(address);
  if (!account) {
    return NextResponse.json(
      { ok: false, error: "validator_unreachable_or_empty" },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    address,
    balance: account.balance,
    balanceSubunits: account.balanceSubunits,
    staked: account.staked,
    pendingUnstake: account.pendingUnstake,
    nonce: account.nonce,
    source: account.source,
    useChainBalanceFlag: useChainBalanceEnabled(),
  });
}
