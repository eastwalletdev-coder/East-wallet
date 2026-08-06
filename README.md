# Hard fix: lightnode stuck #462 + activity kosong

## Root causes (teliti)
1. Lightnode **menolak** header berikutnya karena `Previous hash mismatch` (tip lokal Neon ≠ validator).
2. Archive path memakai `/api/archive/blocks-range` — harus berisi row `chain_source=validator` (jalankan mirror upsert).
3. Peer search 15s + 0 peers → terasa "minta validator terus".
4. Home **Recent Activity** hanya baca Neon — Send on-chain tidak muncul tanpa `chain-activity-local`.

## Files
- `src/lib/lightnode/client.ts` — accept chain cutover; dual archive API; peer timeout 15s
- `src/app/api/archive/blocks-range/route.ts` — prefer validator rows; short cache
- `src/app/page.tsx` — Recent Activity + local on-chain log
- `src/components/SendDialog.tsx` + `src/lib/chain-activity-local.ts`
- mirror/archive helpers (upsert + `/api/archive/headers`)

## Deploy + wajib jalankan
```bash
# 1) Mirror upsert (timpa Neon L2 di height yang sama)
curl -sS -X POST "https://thiseast.vercel.app/api/explorer/sync-from-validator" \
  -H "x-cron-secret: $ADMIN_SECRET" -d '{"lookback":120}'
# expect: updated > 0 or inserted > 0

# 2) Env Vercel
NEXT_PUBLIC_APP_URL=https://thiseast.vercel.app
NEXT_PUBLIC_ALLOW_CHAIN_CUTOVER=true
CHAIN_SIGNING_PRIVATE_KEY=...   # supaya archive bisa sign header
NEXT_PUBLIC_CHAIN_SIGNING_ADDRESS=...

# 3) Clear Mini App data (local tip 462) lalu buka node lagi
```
