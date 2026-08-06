# Fix lightnode tip #461 (Neon) → validator height

## Problem
`/api/chain-height` read `MAX(block_index)` from Neon → ~461.
Validator Railway tip is much lower. Lightnode tries download 0→461 and stalls.

## Fix
Read tip from `EAST_VALIDATOR_URL/block/latest` or `/health` (fallback Hub).

## Deploy
Replace `src/app/api/chain-height/route.ts` on East-wallet, redeploy Vercel.

Env:
```
EAST_VALIDATOR_URL=https://east-validator-production.up.railway.app
RAILWAY_HUB_URL=...   # optional fallback
```

After deploy:
```bash
curl -sS https://YOUR_APP/api/chain-height
# latestHeight should match validator, NOT Neon 461
```

Clear lightnode local progress (optional): wipe Mini App data / localStorage key for lightnode so currentHeight resets.
