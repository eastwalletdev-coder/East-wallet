# Explorer: Neon mirror dari validator (QStash, tanpa Vercel Cron)

## Auth
Sama pola `/api/empty-block`:
1. **QStash** — header `upstash-signature` (production)
2. **Admin** — `x-cron-secret` atau `Authorization: Bearer` = `ADMIN_SECRET`

Tidak perlu `CRON_SECRET` / Vercel Cron (free plan).

## Env (sudah dipakai project Anda)
```
QSTASH_CURRENT_SIGNING_KEY=...
QSTASH_NEXT_SIGNING_KEY=...
ADMIN_SECRET=...                 # uji manual
EAST_VALIDATOR_URL=...
DATABASE_LEDGER_URL=...
UPSTASH_REDIS_REST_URL=...       # optional cache invalidate
```

## Jadwal di Upstash QStash
1. [console.upstash.com](https://console.upstash.com) → **QStash** → **Schedules** → Create
2. URL: `https://YOUR_VERCEL_DOMAIN/api/explorer/sync-from-validator`
3. Method: **POST**
4. Cron: `* * * * *` (tiap 1 menit) atau `*/2 * * * *`
5. Body (optional): `{"lookback":30}`
6. Destination: production URL wallet

QStash akan sign request; route memverifikasi seperti empty-block / mempool process.

## Uji manual
```bash
curl -sS -X POST "https://YOUR_APP/api/explorer/sync-from-validator" \
  -H "x-cron-secret: $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"lookback":30}'
```

## File
- `src/lib/sync-validator-to-neon.ts`
- `src/app/api/explorer/sync-from-validator/route.ts`  ← QStash-ready
- `src/actions/sync-validator-neon-actions.ts`

Repo: **East-wallet → Vercel** (bukan Hub).
