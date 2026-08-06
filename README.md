# Hard fix: lightnode stuck height + Send recent activity

## Bug 1 — Activity missing after Send
`pushLocalActivity` stored **address = recipient**, while `listLocalActivity(walletAddress)` filtered on the **sender wallet** → never matched.

**Fix:** store `wallet` = sender (from mnemonic); Home uses `listAllLocalActivity()` (all device rows). Event `east-chain-activity` refreshes the list after Send.

## Bug 2 — Lightnode stuck after peer wait
After 15s with no peers, archive needs a base URL (`NEXT_PUBLIC_APP_URL` or `window.location.origin`).

**Critical bug in `catchUpFromArchive`:**  
`targetHeight = latestHeight - 1000` made target **negative** when tip &lt; 1000 (e.g. #518), so the function returned **without fetching**. UI logged “catching up from archive” but height stayed #0.

**Fix:** fetch through tip; if genesis missing, jump to archive window (tip − 120); accept prev-hash mismatch / unsigned headers during cutover (`NEXT_PUBLIC_ALLOW_CHAIN_CUTOVER`).

## Deploy
Overwrite files from this zip into **East-wallet**, push, deploy Vercel.

```bash
curl -sS -X POST "https://YOUR_APP/api/explorer/sync-from-validator" \
  -H "x-cron-secret: $ADMIN_SECRET" \
  -d '{"lookback":150}'
```

Env:
```
NEXT_PUBLIC_APP_URL=https://YOUR_APP
NEXT_PUBLIC_ALLOW_CHAIN_CUTOVER=true
EAST_VALIDATOR_URL=https://your-validator.up.railway.app
```

Clear Mini App data if local tip is still stuck on the old Neon chain tip.
