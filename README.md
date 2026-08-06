# Fix teliti: Activity kosong + lightnode #462

## Bug 1 — Activity tidak muncul setelah Send
`pushLocalActivity` menyimpan **address = penerima**, lalu `listLocalActivity(walletAddress)` memfilter **address === wallet user** → **tidak pernah cocok**.

Perbaikan: field `wallet` = alamat pengirim (dari mnemonic); list memfilter `wallet` atau counterparty.

## Bug 2 — Lightnode stuck setelah 15s peer
Setelah peer kosong, archive butuh `NEXT_PUBLIC_APP_URL`. Sekarang fallback `window.location.origin`.
Header validator sering **tanpa** signature Vercel → ditolak. Cutover menerima unsigned + prev-hash mismatch.

## Deploy
Timpa semua file di zip → push Vercel.

```bash
# Mirror archive validator → Neon
curl -sS -X POST "https://thiseast.vercel.app/api/explorer/sync-from-validator" \
  -H "x-cron-secret: $ADMIN_SECRET" -d '{"lookback":120}'
```

Env:
```
NEXT_PUBLIC_ALLOW_CHAIN_CUTOVER=true
NEXT_PUBLIC_APP_URL=https://thiseast.vercel.app
```

Lalu **Send lagi** (log lama tanpa field wallet tetap ditampilkan lewat legacy filter).
Clear Mini App data jika lightnode masih #462.
