# Phase 3 — UI balance from chain (via Hub)

## New files (copy into east-wallet repo)

| Path | Role |
|------|------|
| `src/lib/chain-balance.ts` | Fetch account from Hub `/rpc/account` or validator `/account` |
| `src/app/api/chain/balance/route.ts` | `GET /api/chain/balance?address=0x...` |

## Vercel env

```bash
# Prefer Hub (Phase 2 gateway) — same base URL as RAILWAY_HUB_URL if you already have it
RAILWAY_HUB_URL=https://your-hub.up.railway.app

# Optional fallback if Hub is down
EAST_VALIDATOR_URL=https://your-validator.up.railway.app

# Flip display to chain (keep false until Hub health.chain.ok === true)
USE_CHAIN_BALANCE=true
```

`RAILWAY_HUB_URL` is already referenced by `hub-notify.ts` — reuse it.

## Test without full UI wiring

```bash
curl -s "https://YOUR-VERCEL-APP/api/chain/balance?address=0xYourAddress"
```

Expect `balance` in human EAST (subunits / 1e6).

## Onboarding patch

See `PATCH-onboarding.md` — one import + `applyChainBalanceToUser` on user returns.

## Notes

- Neon is still written by mining/claim until Phase 4.
- Chain account with no activity returns zeros (not an error).
- Stake fields on validator use the same 6-decimal scale as balance.
