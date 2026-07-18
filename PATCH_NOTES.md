# Patch: fix 504 di /api/archive/blocks/[height] — startup chain jangan re-run tiap cold start

## Akar masalah

`src/instrumentation.ts` (`register()`) jalan otomatis di SETIAP cold
start serverless instance, bukan cuma sekali per deployment. Isinya:
`initIdentitySchema`, `initLedgerSchema`, 7 fungsi `migrateIdentityVx`,
6 fungsi `migrateLedgerVx`/`migrateSchemaV2`, `migrateContractSchema`
(total 13+ round-trip DB berurutan), lalu `backfillKeypairs()` (loop
per user), `recoverFromChannel()` (fetch history Telegram channel),
dan `runEpoch()` (hitung PoC penuh) — semua di-`await` berurutan
SEBELUM instance itu sempat melayani request pertamanya.

`/api/archive/blocks/[height]` adalah route baru yang jarang punya
instance warm. `catchUpFromArchive()` di client juga nembak
`ARCHIVE_CONCURRENCY = 8` request paralel sekaligus saat gap besar —
Vercel spin up beberapa instance cold bersamaan, dan tiap satu wajib
nyelesain seluruh chain di atas dulu sebelum bisa balikin data block.
Itu yang bikin lewat timeout Vercel → 504 berulang di block yang sama.

Migration v6 sendiri (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS
has_first_claimed`) ringan — bukan biang keladinya sendirian. Yang
berat itu SELURUH chain yang re-run terus-menerus.

## File yang berubah

- `src/lib/db/identity.ts` — **tambah** 2 fungsi baru:
  `hasStartupChainCompleted()` dan `markStartupChainCompleted()`.
  Pola sama seperti guard `schema_flags` yang sudah dipakai
  `migrateIdentityV4`. Tidak mengubah fungsi migration yang sudah ada
  sama sekali.
- `src/instrumentation.ts` — **diubah**. `register()` sekarang:
  1. Cek `hasStartupChainCompleted()` dulu. Kalau sudah pernah sukses,
     SKIP seluruh chain init/migration (13+ round trip tadi).
  2. Kalau belum, jalankan seperti biasa, lalu tandai selesai dengan
     `markStartupChainCompleted()` di akhir — jadi cold start
     berikutnya otomatis skip.
  3. `backfillKeypairs()`, `recoverFromChannel()`, `runEpoch()` diubah
     jadi fire-and-forget (tidak di-`await`) — tetap jalan di
     background, tapi tidak lagi menahan response request yang
     memicu cold start itu.

## Yang SENGAJA tidak diubah

- Urutan dan isi tiap fungsi `migrateIdentityVx`/`migrateLedgerVx` —
  tidak disentuh sama sekali, resikonya nol untuk data yang sudah ada.
- Scheduler `setInterval` 24 jam untuk `runEpoch()` — tetap sama.
- Behavior retry: kalau `hasStartupChainCompleted()` sendiri gagal
  (mis. Neon lagi wake-up dari idle-suspend), exception itu ketangkep
  di try/catch luar seperti sebelumnya — `markStartupChainCompleted()`
  otomatis tidak kepanggil, jadi cold start berikutnya retry lagi
  dari awal. Tidak ada perubahan perilaku di skenario gagal.

## Cara pakai

Copy 2 file di atas ke posisi yang sama persis di repo (timpa yang
lama), commit + push. Setelah deploy pertama sukses (flag
`startup_chain_v1_completed` ke-set di `identity.schema_flags`), cold
start berikutnya — termasuk buat `/api/archive/blocks/[height]` —
harusnya jauh lebih cepat dan 504-nya hilang.

## Cara verifikasi setelah deploy

1. Buka Vercel → Logs → filter route `/api/archive/blocks/`. Harusnya
   status 200, bukan 504 lagi (kecuali height-nya memang belum ada di
   `ledger.blocks`, itu wajar 404).
2. Cek Neon: `SELECT * FROM identity.schema_flags WHERE flag =
   'startup_chain_v1_completed';` — harus ada 1 baris setelah deploy
   pertama.
3. Light node yang tadinya stuck di block #680 harusnya lanjut
   catch-up begitu archive endpoint mulai balas cepat.
