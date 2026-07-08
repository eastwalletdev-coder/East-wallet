# Dual-Mode Transaction Authorization

EastChain sekarang support **dua cara** untuk authorize transaksi EAST:

## 1. Telegram (Original, Masih Berlaku)

User buka Mini App di Telegram → `initData` dari Telegram → sign transaksi.

```typescript
// Contoh dari UI Mini App:
await sendEast(
  telegramId,
  recipientAddress,
  amount,
  initData  // dari Telegram.WebApp.initData
);
```

## 2. Self-Custody Signature (Baru — dari Luar Telegram)

User punya self-custody pubkey terdaftar → sign payload lokal → kirim signature ke server.

```typescript
// Contoh dari script Node.js:
const mnemonic = decryptVault(password);
const pubkeyHex = pubkeyFromMnemonic(mnemonic);
const payload = `SEND_EAST|${telegramId}|${recipientAddress}|${amount}`;
const signature = signMessage(mnemonic, payload);

await sendEast(
  telegramId,
  recipientAddress,
  amount,
  undefined,  // NO initData (bukan dari Mini App)
  signature,  // signature lokal
  pubkeyHex
);
```

## Apa yang Berubah?

**Sebelum:** identitas **selalu** terikat Telegram (`initData`). Hanya aplikasi Telegram yang bisa send transaksi.

**Sesudah:** identitas bisa **initData ATAU signature**. Siapa saja dengan self-custody key bisa transaksi dari **mana saja** (script, web lain, node eksternal, etc).

## Kontrak-Kontrak yang Kena:

- `sendEast()` — transfer EAST antar user
- `stakeEast()` — lock token jadi validator/power
- `claimMiningReward()` — claim mining reward
- Semua contract lain via `callContract()` (staking, vesting, governance votes, etc)

## Keamanan

- Signature diverifikasi dengan public key yang terdaftar di DB — tidak bisa forged tanpa private key.
- Private key **tidak pernah dikirim** ke server — hanya signature.
- Server masih bisa serve **SALAH SATU** (initData ATAU signature), backward-compatible penuh.

## Flow Praktis untuk Node Validator

(Lihat `scripts/heartbeat-daemon.js` dan `scripts/apply-validator-cli.js`)

1. CLI: generate/import mnemonic → encrypt vault lokal
2. CLI: register self-custody pubkey (signature-verified)
3. CLI: apply jadi validator candidate (signature-verified)
4. Daemon: baca vault → tiap 30s sign & kirim heartbeat
5. Jika di masa depan node harus eksekusi block: sign block dengan key lokal, kirim signature + block ke server

## Rest API Routes (Untuk Script Eksternal)

```bash
# Register self-custody
POST /api/self-custody/register
{
  "telegramId": "123456789",
  "pubkeyHex": "...",
  "signatureHex": "...",
  "adminSecret": "..." // optional, untuk admin bypass
}

# Apply validator
POST /api/self-custody/apply-validator
{
  "telegramId": "123456789",
  "pubkeyHex": "...",
  "signatureHex": "...",
  "adminSecret": "..."
}

# Heartbeat (dari node eksternal)
POST /api/node/heartbeat
{
  "telegramId": "123456789",
  "timestampMs": 1720000000000,
  "signature": "..."
}
```

## Testing

Untuk test signature-based transaksi dari script:

```javascript
import { sendEast } from '@/actions/mining-actions';

const result = await sendEast(
  '123456789',           // tgId
  '0x...',               // recipientAddress
  100,                   // amount
  undefined,             // NO initData
  signatureHex,          // signature atas payload
  pubkeyHex              // pubkey yang terdaftar
);
```

## Backward Compatibility

- Aplikasi Mini App yang sekarang pakai `initData` tetap jalan 100% sama — tidak ada perubahan.
- Kalau kirim **keduanya** (initData dan signature), server terima yang manapun (initData dulu, kalau invalid coba signature).
- Kalau kirim **cuma signature**, tetap diterima (asal pubkey terdaftar dan signature valid).
