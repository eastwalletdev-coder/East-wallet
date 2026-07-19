# Patch: bersihin log basi "archived to R2" + naikin timeout Railway publish

## Konteks

Dari log deploy terbaru muncul 2 hal — keduanya BUKAN berhubungan
dengan bug archive route yang kemarin (itu sudah beres, block #788
kelihatan sealed normal):

## 1. "archived to R2" — cuma teks log basi, bukan bug

`sealBlock()` di `block-engine.ts` memang sudah gak pernah manggil
`archiveBlockToR2()` lagi sejak pindah ke NeonDB. Cuma komentar +
`console.log` di `src/app/api/empty-block/route.ts` yang lupa
di-update, jadi kelihatan salah padahal block-nya beneran sudah benar
tersimpan Postgres.

**File**: `src/app/api/empty-block/route.ts` — update komentar +ubah
log jadi `"sealed (signed + archived to Postgres)"`.

## 2. Railway publish AbortError — beneran timeout, non-fatal

`publishBlockToRailway()` di `lightnode-publisher.ts` pasang batas 3
detik buat POST notifikasi block baru ke Railway hub. Railway free
tier suka sleep pas idle, cold-start-nya kadang lebih dari 3 detik →
`AbortError`. Ini **tidak** menggagalkan block sealing (block #788
tetap sealed sukses di log yang sama, function ini fire-and-forget /
gak di-`await` di `block-engine.ts`) — cuma bikin log rame dan light
node kehilangan satu push WS real-time (tapi tetap ke-catch lewat
archive catch-up berikutnya).

**File**: `src/lib/lightnode-publisher.ts` — naikin timeout dari 3000ms
ke 8000ms, kasih ruang buat Railway cold-start.

## Yang TIDAK diubah

Tidak ada perubahan logic sealing, archiving, atau signing — murni
teks log + satu angka timeout.
