# Patch: fix build error + drop R2, serve archive from Vercel/Postgres

## File yang berubah

- `src/lib/db/redis.ts` — **tambah** export `checkArchiveRateLimit` (ini
  yang bikin build gagal — dulu di-import tapi tidak pernah ada).
- `src/app/api/archive/blocks/[height]/route.ts` — **file baru**.
  Menggantikan route lama yang serve dari R2. Sekarang baca langsung dari
  `ledger.blocks` di Postgres, signature blok di-generate ulang saat
  request (deterministik dari `CHAIN_SIGNING_PRIVATE_KEY` + height + hash,
  jadi tidak perlu kolom baru di DB).
- `src/lib/lightnode/client.ts` — **diubah**. `catchUpFromArchive()`
  sekarang fetch ke `{APP_URL}/api/archive/blocks/{height}` (endpoint
  Vercel di atas), bukan `{R2_URL}/blocks/{height}.json`. Trigger-nya juga
  diubah: kalau `NEXT_PUBLIC_ARCHIVE_BASE_URL` kosong, otomatis fallback ke
  `NEXT_PUBLIC_APP_URL`.
- `src/lib/block-engine.ts` — **diubah**. Hapus import dan panggilan
  `archiveBlockToR2()` di `sealBlock()` — tidak menulis ke R2 lagi setiap
  blok disegel, karena archive sekarang dibaca on-demand dari Postgres.
- `.env.example` — komentar diperbarui: `CLOUDFLARE_R2_*` sekarang
  opsional/tidak dipakai.

## Yang SENGAJA tidak disentuh

`src/lib/archive/r2-client.ts`, `src/lib/archive/reconcile.ts`, dan
`src/app/api/admin/reconcile-archive/route.ts` masih ada di repo (tidak
dihapus) — mereka masih saling import satu sama lain jadi aman untuk
build, tapi sekarang jadi dead code karena tidak ada lagi yang memanggil
`archiveBlockToR2()`. Aman dibiarkan, atau boleh dihapus manual kapan-kapan
kalau mau beres-beres — tidak saya sertakan di patch ini supaya scope-nya
tetap kecil dan risikonya rendah.

## Env var yang perlu dicek di Vercel

- `CHAIN_SIGNING_PRIVATE_KEY` — kalau belum di-set, endpoint archive baru
  tetap jalan tapi `signature` akan `null` (sama seperti perilaku lama).
- `NEXT_PUBLIC_APP_URL` — pastikan ini di-set ke URL app Anda sendiri
  (mis. `https://your-app.vercel.app`), karena sekarang jadi fallback
  sumber archive kalau `NEXT_PUBLIC_ARCHIVE_BASE_URL` kosong.
- `CLOUDFLARE_R2_*` dan `NEXT_PUBLIC_ARCHIVE_BASE_URL` — boleh dikosongkan
  sepenuhnya di Vercel sekarang.

## Cara pakai

Copy 5 file di atas ke posisi yang sama persis di repo Anda (timpa yang
lama), lalu commit + push. Build error `checkArchiveRateLimit` akan
langsung hilang, dan light node akan otomatis pakai jalur baru begitu
deploy selesai — tidak perlu migrasi database, tidak perlu setting baru
kalau `NEXT_PUBLIC_APP_URL` sudah ada.
