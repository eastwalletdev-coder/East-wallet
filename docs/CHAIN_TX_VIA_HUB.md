# Send / Stake via Browser Hub → east-validator

## Flow

```
Wallet UI (SendDialog / EastPass)
    │  sign EIP-191: EASTCHAIN_TX|{sha256(json)}
    ▼
POST /api/chain/tx   (Next.js on Vercel — avoids CORS)
    │
    ▼
POST {RAILWAY_HUB_URL}/rpc/tx
    │  Hub attaches X-API-Secret
    ▼
POST {EAST_VALIDATOR_URL}/tx   (Go sealer mempool)
```

Legacy Neon `sendEast` / `stakeEast` remain available when the flag is off.

## Env (Vercel)

```bash
# Hub base URL (no trailing slash) — same as Phase 3 balance read
RAILWAY_HUB_URL=https://your-hub.up.railway.app

# Opt-in: wire Send + Stake buttons to chain path
NEXT_PUBLIC_USE_CHAIN_TX=true

# Optional direct fallback if Hub is down (needs API secret on Vercel)
# EAST_VALIDATOR_URL=https://your-validator.up.railway.app
# EAST_VALIDATOR_API_SECRET=...
```

## Env (Railway Hub)

```bash
EAST_VALIDATOR_URL=https://your-validator.up.railway.app
VALIDATOR_API_SECRET=<same as validator API_SECRET>
RAILWAY_VALIDATOR_SECRET=...   # existing WS publish secret
```

## Tx shape (must match Go `internal/tx/tx.go`)

| Field | transfer / stake |
|-------|------------------|
| `type` | `"transfer"` \| `"stake"` \| `"request_unstake"` \| … |
| `from` | lowercase `0x…` EVM address of signer |
| `to` | lowercase recipient (`""` for non-transfer) |
| `amount` | **subunits** (1 EAST = 1_000_000) |
| `nonce` | last on-chain nonce **+ 1** |
| `timestamp` | unix ms |
| `signature` | ethers `personal_sign("EASTCHAIN_TX\|" + hash)` |

Hash = `SHA-256( JSON.stringify({type,from,to,amount,nonce,timestamp}) )`  
with the same key order as Go’s struct.

## Code map

| File | Role |
|------|------|
| `src/lib/chain-tx.ts` | hash helpers, subunit conversion, feature flag |
| `src/lib/chain-tx-client.ts` | browser sign + `submitChainTransfer` / `submitChainStake` |
| `src/app/api/chain/tx/route.ts` | proxy to Hub `/rpc/tx` |
| `src/components/SendDialog.tsx` | Send button → chain path when flag on |
| `src/app/eastpass/page.tsx` | Stake / unstake → chain path when flag on |

## Preconditions

1. Recipient (and sender) must already have an account balance **on the validator** (seed or prior mint/transfer). Neon balance alone is not enough for the on-chain path.
2. Vault must be unlocked (mnemonic available) so the UI can sign with the EVM key derived at `m/44'/60'/0'/0/0`.
3. Hub `GET /health` should show `chain.ok: true`.

## Manual test

```bash
# 1) Read nonce + balance
curl -s "$HUB/rpc/account/0xYourAddress"

# 2) From the Mini App: enable NEXT_PUBLIC_USE_CHAIN_TX, unlock vault, Send EAST

# 3) Confirm mempool / block on validator
curl -s "$VALIDATOR/block/latest"
```
