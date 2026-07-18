# Patch: fix Light Node gak bisa catch-up — konflik routing archive endpoint

## Akar masalah (2 lapis)

1. **Konflik dynamic route**: repo Anda sudah punya
   `src/app/api/archive/blocks/[heightJson]/route.ts` dari SEBELUMNYA —
   versi lengkap dengan two-tier lookup (`ledger.blocks` lalu fallback
   `identity.archive_blocks` cold storage). Patch archive kemarin
   (`eastchain-patch-archive-vercel-fix.zip`) bikin folder BARU
   `[height]` di posisi path yang SAMA. Next.js tidak mengizinkan dua
   nama dynamic segment berbeda (`height` vs `heightJson`) di level
   yang sama — bikin build error / routing ambigu.

2. **Response shape gak cocok**: bahkan kalau `[heightJson]` yang
   kepakai, JSON-nya tidak punya field `success: true`. Tapi
   `catchUpFromArchive()` di `src/lib/lightnode/client.ts` cuma
   nganggep block valid kalau `body?.success` ada — jadi SEMUA block
   dianggap "missing", langsung fallback ke ring buffer Railway yang
   cuma nampung ~20 block. Light Node gak akan pernah bisa ngejar gap
   besar walau server-nya sendiri sehat.

Catatan: tombol "Prune L2" (`performRollingArchive()`) ternyata cuma
COPY ke `identity.archive_blocks`, tidak pernah `DELETE FROM
ledger.blocks` — jadi bukan penyebab, aman diabaikan.

## File yang berubah

- `src/app/api/archive/blocks/[heightJson]/route.ts` — tambah
  `success: true` di 2 response sukses-nya (tier 1 `ledger.blocks`,
  tier 2 `identity.archive_blocks`). Tidak ada logic lain yang diubah
  — dua-tier lookup yang sudah ada (termasuk fallback cold storage)
  tetap dipakai apa adanya karena memang lebih lengkap dari versi
  patch kemarin.

## WAJIB: hapus folder duplikat

Folder ini dari patch kemarin **harus dihapus** dari repo Anda (bukan
ditimpa, benar-benar dihapus foldernya):

    src/app/api/archive/blocks/[height]/

Kalau masih ada bareng `[heightJson]`, build tetap akan konflik.
Setelah dihapus, copy file `[heightJson]/route.ts` dari patch ini ke
posisi yang sama (timpa yang lama), commit + push.

## Cara verifikasi

1. Build Vercel sukses tanpa error "different slug names for the same
   dynamic path".
2. `curl https://<app-url>/api/archive/blocks/680` — respons harus ada
   `"success":true`.
3. Light Node yang tadinya nyangkut mulai nambah currentHeight lagi —
   cek panel Light Node di app (log "Archive catch-up complete — N
   block(s) verified from archive").
