import { NextRequest, NextResponse } from "next/server";
import { identityPool } from "@/lib/db/identity";
import { verifyIdentityOrSignature } from "@/lib/auth/dual-mode-identity";

/**
 * POST /api/chain/transfer-onchain
 *
 * HOME "Deposit mining → chain" — NOT Wallet Send.
 *
 * Self-service bridge (user-triggered migration):
 *   1) Debit identity.users.balance (Neon) — mining / app balance
 *   2) Credit validator free balance (GET /account + POST /admin/seed)
 *
 * Wallet tab Send uses /api/chain/tx only (peer transfer on validator).
 * Do not use this route for peer-to-peer Send.
 *
 * Body: telegramId, amount (human EAST), toAddress?, initData?, signature?, ...
 * Env: EAST_VALIDATOR_URL, EAST_VALIDATOR_API_SECRET | API_SECRET
 */

const SUBUNITS = 1_000_000;

function validatorBase(): string {
  return (
    process.env.EAST_VALIDATOR_URL ||
    process.env.VALIDATOR_HTTP_URL ||
    ""
  )
    .trim()
    .replace(/\/$/, "");
}

function apiSecret(): string {
  return (
    process.env.EAST_VALIDATOR_API_SECRET ||
    process.env.API_SECRET ||
    ""
  ).trim();
}

async function fetchOnchainBalance(address: string): Promise<number> {
  const base = validatorBase();
  const res = await fetch(`${base}/account/${encodeURIComponent(address)}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) return 0;
  const j = (await res.json()) as { balance?: number | string };
  const n = Number(j.balance ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** SET absolute balance on validator (SeedBalance). Caller must pass new total. */
async function seedOnchainBalance(address: string, balanceSubunits: number): Promise<void> {
  const base = validatorBase();
  const secret = apiSecret();
  if (!base) throw new Error("EAST_VALIDATOR_URL not configured");
  if (!secret) throw new Error("EAST_VALIDATOR_API_SECRET / API_SECRET not configured");

  const res = await fetch(`${base}/admin/seed`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Secret": secret,
    },
    body: JSON.stringify({ address, balance: balanceSubunits }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`validator seed failed: ${res.status} ${text}`);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const telegramId = String(body.telegramId || "").trim();
    const amount = Number(body.amount);
    const initData = body.initData as string | undefined;
    const signature = body.signature as string | undefined;
    const signaturePayload = body.signaturePayload as string | undefined;
    const selfCustodyPubkey = body.selfCustodyPubkey as string | undefined;
    const toAddressOverride = body.toAddress
      ? String(body.toAddress).trim()
      : "";

    if (!telegramId) {
      return NextResponse.json({ ok: false, error: "telegramId required" }, { status: 400 });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ ok: false, error: "amount must be > 0" }, { status: 400 });
    }
    // Max per transfer: 1M EAST human (safety)
    if (amount > 1_000_000) {
      return NextResponse.json({ ok: false, error: "amount exceeds per-transfer max" }, { status: 400 });
    }

    if (!validatorBase()) {
      return NextResponse.json(
        { ok: false, error: "EAST_VALIDATOR_URL not configured" },
        { status: 503 },
      );
    }

    const isProduction = process.env.NODE_ENV === "production";

    // Pre-load user for evm address used in signature verify
    const client = await identityPool.connect();
    try {
      await client.query("BEGIN");

      const userRes = await client.query(
        `SELECT telegram_id, wallet_address, balance, wallet_type, self_custody_pubkey
         FROM identity.users WHERE telegram_id = $1 FOR UPDATE`,
        [telegramId],
      );
      if (!userRes.rows.length) {
        await client.query("ROLLBACK");
        return NextResponse.json({ ok: false, error: "USER_NOT_FOUND" }, { status: 404 });
      }
      const user = userRes.rows[0];
      const neonBalance = Number(user.balance) || 0;
      if (neonBalance < amount) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { ok: false, error: "INSUFFICIENT_NEON_BALANCE", available: neonBalance },
          { status: 400 },
        );
      }

      const toAddress = (toAddressOverride || user.wallet_address || "").trim();
      if (!toAddress.startsWith("0x") || toAddress.length < 10) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { ok: false, error: "invalid toAddress / wallet_address" },
          { status: 400 },
        );
      }

      const auth = await verifyIdentityOrSignature(
        telegramId,
        initData,
        selfCustodyPubkey || user.self_custody_pubkey || undefined,
        signature,
        signaturePayload || `TRANSFER_ONCHAIN|${telegramId}|${toAddress.toLowerCase()}|${amount}`,
        isProduction,
        toAddress,
      );
      if (!auth.success) {
        await client.query("ROLLBACK");
        return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
      }

      // Debit Neon first
      const debit = await client.query(
        `UPDATE identity.users
         SET balance = balance - $1, updated_at = NOW()
         WHERE telegram_id = $2 AND balance >= $1
         RETURNING balance`,
        [amount, telegramId],
      );
      if (!debit.rows.length) {
        await client.query("ROLLBACK");
        return NextResponse.json({ ok: false, error: "INSUFFICIENT_NEON_BALANCE" }, { status: 400 });
      }
      const neonAfter = Number(debit.rows[0].balance);

      // Credit on-chain: read current subunits, add amount * 1e6
      const subunitsToAdd = Math.round(amount * SUBUNITS);
      let onchainBefore = 0;
      try {
        onchainBefore = await fetchOnchainBalance(toAddress);
      } catch (e: any) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { ok: false, error: `validator_unreachable: ${e?.message || e}` },
          { status: 502 },
        );
      }
      const onchainAfter = onchainBefore + subunitsToAdd;

      try {
        await seedOnchainBalance(toAddress, onchainAfter);
      } catch (e: any) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { ok: false, error: e?.message || "validator_seed_failed" },
          { status: 502 },
        );
      }

      await client.query("COMMIT");

      return NextResponse.json({
        ok: true,
        kind: "neon_to_chain_deposit",
        telegramId,
        toAddress,
        amountHuman: amount,
        amountSubunits: subunitsToAdd,
        neonBalanceAfter: neonAfter,
        onchainBalanceAfter: onchainAfter,
        onchainBalanceAfterHuman: onchainAfter / SUBUNITS,
      });
    } catch (e: any) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* ignore */
      }
      return NextResponse.json(
        { ok: false, error: e?.message || "internal_error" },
        { status: 500 },
      );
    } finally {
      client.release();
    }
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "bad_request" },
      { status: 400 },
    );
  }
}
