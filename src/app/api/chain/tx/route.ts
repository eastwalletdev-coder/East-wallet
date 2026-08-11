import { NextRequest, NextResponse } from "next/server";
import { recordTransferForActivity } from "@/lib/record-chain-tx-ledger";

/**
 * POST /api/chain/tx
 *
 * Public proxy: browser → this route → Railway Hub /rpc/tx → east-validator /tx.
 * Avoids CORS (Hub has no CORS headers) and keeps VALIDATOR_API_SECRET only on Hub.
 *
 * Body = signed chain transaction JSON (see src/lib/chain-tx.ts):
 * {
 *   type: "transfer" | "stake" | "request_unstake" | "claim_unstake" | "claim_mining",
 *   from: "0x...",
 *   to: "0x..." | "",
 *   amount: number,   // subunits for transfer/stake
 *   nonce: number,
 *   timestamp: number,
 *   signature: "0x...",
 *   payload?: object
 * }
 *
 * Env (server):
 *   RAILWAY_HUB_URL or EAST_HUB_URL — Hub base URL
 *   Optional fallback: EAST_VALIDATOR_URL + EAST_VALIDATOR_API_SECRET
 *     (direct to validator if Hub not configured)
 */

function hubBase(): string {
  return (process.env.RAILWAY_HUB_URL || process.env.EAST_HUB_URL || "")
    .trim()
    .replace(/\/$/, "");
}

function validatorBase(): string {
  return (process.env.EAST_VALIDATOR_URL || process.env.VALIDATOR_HTTP_URL || "")
    .trim()
    .replace(/\/$/, "");
}

function validatorSecret(): string {
  return (
    process.env.EAST_VALIDATOR_API_SECRET ||
    process.env.VALIDATOR_API_SECRET ||
    process.env.API_SECRET ||
    ""
  ).trim();
}

const ALLOWED_TYPES = new Set([
  "transfer",
  "stake",
  "request_unstake",
  "claim_unstake",
  "claim_mining",
]);


async function maybeIndexTransfer(body: Record<string, unknown>, json: unknown) {
  if (String(body.type || "") !== "transfer") return;
  const from = String(body.from || "");
  const to = String(body.to || "");
  const amount = Number(body.amount);
  let txHash = "";
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    txHash = String(o.tx_hash || o.txHash || o.hash || "");
    if (!txHash && o.raw && typeof o.raw === "object") {
      const r = o.raw as Record<string, unknown>;
      txHash = String(r.tx_hash || r.txHash || r.hash || "");
    }
  }
  if (!txHash) txHash = `transfer-${from.slice(0, 10)}-${Date.now()}`;
  await recordTransferForActivity({
    txHash,
    from,
    to,
    amount,
    amountIsSubunits: true,
    status: "confirmed",
  });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const type = String(body.type || "");
  if (!ALLOWED_TYPES.has(type)) {
    return NextResponse.json(
      { ok: false, error: `unsupported_type: ${type}` },
      { status: 400 },
    );
  }
  if (!body.from || typeof body.from !== "string" || !body.from.startsWith("0x")) {
    return NextResponse.json({ ok: false, error: "from required (0x...)" }, { status: 400 });
  }
  if (!body.signature || typeof body.signature !== "string") {
    return NextResponse.json({ ok: false, error: "signature required" }, { status: 400 });
  }
  if (typeof body.amount !== "number" || !Number.isFinite(body.amount) || body.amount <= 0) {
    return NextResponse.json({ ok: false, error: "amount must be a positive number" }, { status: 400 });
  }
  if (typeof body.nonce !== "number" || body.nonce < 0) {
    return NextResponse.json({ ok: false, error: "nonce required" }, { status: 400 });
  }
  if (typeof body.timestamp !== "number" || body.timestamp <= 0) {
    return NextResponse.json({ ok: false, error: "timestamp required" }, { status: 400 });
  }
  if (type === "transfer") {
    const to = String(body.to || "");
    if (!to.startsWith("0x") || to.length < 10) {
      return NextResponse.json({ ok: false, error: "to required for transfer" }, { status: 400 });
    }
  }

  // Normalize addresses lower-case so Hash() matches client build
  const normalized = {
    ...body,
    type,
    from: String(body.from).toLowerCase(),
    to: body.to ? String(body.to).toLowerCase() : "",
    amount: Math.trunc(Number(body.amount)),
    nonce: Math.trunc(Number(body.nonce)),
    timestamp: Math.trunc(Number(body.timestamp)),
    signature: String(body.signature),
  };

  const payload = JSON.stringify(normalized);
  const hub = hubBase();
  const val = validatorBase();

  // Prefer Hub gateway (attaches API secret server-side on Hub)
  if (hub) {
    try {
      const res = await fetch(`${hub}/rpc/tx`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: payload,
        signal: AbortSignal.timeout(20_000),
        cache: "no-store",
      });
      const text = await res.text();
      let json: unknown = text;
      try {
        json = JSON.parse(text);
      } catch {
        /* keep text */
      }
      if (!res.ok) {
        return NextResponse.json(
          {
            ok: false,
            error: "hub_tx_rejected",
            status: res.status,
            detail: json,
          },
          { status: res.status >= 400 && res.status < 600 ? res.status : 502 },
        );
      }
      try {
        await maybeIndexTransfer(body, json);
      } catch { /* ignore */ }
      return NextResponse.json({
        ok: true,
        via: "hub",
        ...(typeof json === "object" && json ? (json as object) : { raw: json }),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      // Fall through to direct validator if configured
      if (!val) {
        return NextResponse.json(
          { ok: false, error: "hub_unreachable", detail: message },
          { status: 502 },
        );
      }
    }
  }

  // Direct validator fallback (needs API secret on Vercel)
  if (val) {
    const secret = validatorSecret();
    if (!secret) {
      return NextResponse.json(
        {
          ok: false,
          error: "EAST_VALIDATOR_API_SECRET not set — cannot POST /tx directly",
        },
        { status: 503 },
      );
    }
    try {
      const res = await fetch(`${val}/tx`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-API-Secret": secret,
        },
        body: payload,
        signal: AbortSignal.timeout(20_000),
        cache: "no-store",
      });
      const text = await res.text();
      let json: unknown = text;
      try {
        json = JSON.parse(text);
      } catch {
        /* keep */
      }
      if (!res.ok) {
        return NextResponse.json(
          { ok: false, error: "validator_tx_rejected", status: res.status, detail: json },
          { status: res.status >= 400 && res.status < 600 ? res.status : 502 },
        );
      }
      try {
        await maybeIndexTransfer(body, json);
      } catch { /* ignore */ }
      return NextResponse.json({
        ok: true,
        via: "validator",
        ...(typeof json === "object" && json ? (json as object) : { raw: json }),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { ok: false, error: "validator_unreachable", detail: message },
        { status: 502 },
      );
    }
  }

  return NextResponse.json(
    {
      ok: false,
      error: "chain write not configured — set RAILWAY_HUB_URL (preferred) or EAST_VALIDATOR_URL + API secret",
    },
    { status: 503 },
  );
}
