# EASTCHAIN Validator Setup Scripts

Scripts untuk calon validator EastChain — siap jadi validator aktif dengan self-custody key dan heartbeat liveness.

## Prerequisites

- Node.js v16+ (karena `crypto.scryptSync`, `ed25519-hd-key`, dll)
- `npm install` sudah dijalankan di root project (supaya dependencies ada)
- Telegram ID numeric Anda (bisa dapat dari `/start` Telegram bot atau aplikasi)
- VPS/server dengan uptime stabil (untuk daemon jalan 24/7)

## Setup Flow

### 1. Register Self-Custody + Apply as Validator Candidate

Jalankan **sekali** di machine manapun (bisa dari laptop):

```bash
node scripts/apply-validator-cli.js
```

Script ini akan:
- Tanya URL API EastChain, Telegram ID, dll
- Buat atau import mnemonic (private key)
- **Encrypt ke vault lokal** di `.eastchain-validator-vault.json` (chmod 600, hanya bisa dibaca user ini)
- Sign dan register self-custody pubkey ke server
- Sign dan apply sebagai calon validator (status: `pending_review`)

Output: mnemonic sudah aman di vault, siap untuk daemon.

### 2. Wait for Admin Approval

Admin mereview pengajuan Anda (cek `/api/consensus` atau dashboard) dan approve status jadi `approved`. 
Kemudian, validator terakhir harus masuk top-N oleh scoring PoC (`runEpoch` harian) — baru `is_active=TRUE` di `identity.validators`.

Check: apakah status Anda `approved` di `identity.validator_candidates` DAN `is_active=TRUE` di `identity.validators`.

### 3. Start Heartbeat Daemon

**Pindahkan** vault ke server/VPS calon validator:

```bash
# Di VPS:
scp user@laptop:.eastchain-validator-vault.json /path/to/eastchain-validator-vault.json
chmod 600 /path/to/eastchain-validator-vault.json
```

Lalu jalankan daemon **terus-menerus** (gunakan systemd/supervisor/tmux):

```bash
node scripts/heartbeat-daemon.js
```

Atau dengan env var (supaya tidak perlu prompt):

```bash
EASTCHAIN_API_URL=https://your-app.vercel.app \
EASTCHAIN_TELEGRAM_ID=123456789 \
EASTCHAIN_VAULT_PATH=/path/to/.eastchain-validator-vault.json \
node scripts/heartbeat-daemon.js
```

Daemon ini:
- Membaca vault lokal (tanya password sekali saat startup)
- Kirim heartbeat tiap 30 detik ke `/api/node/heartbeat`
- Server track `last_heartbeat_at` Anda — jadi Anda counted sebagai "active external validator"
- Kalau ≥2 validator eksternal aktif, leader-proposal mode aktif dan Anda punya chance dapat giliran eksekusi block

## Environment Variables

**Optional** (untuk skip prompts):

- `EASTCHAIN_API_URL` — URL API, e.g. `https://your-app.vercel.app`
- `EASTCHAIN_TELEGRAM_ID` — Telegram ID Anda (numeric)
- `EASTCHAIN_VAULT_PATH` — Path ke vault file (default: `.eastchain-validator-vault.json` di dir script)
- `EASTCHAIN_ADMIN_SECRET` — (CLI only) bypass Telegram verification jika Anda adalah admin; sama dengan `ADMIN_SECRET` di Vercel env

## Important Notes

### Security

- **Vault encryption:** AES-256-GCM + scrypt-derived key. Password hanya dipakai untuk unlock di startup, tidak pernah dikirim ke server.
- **Private key never leaves the machine:** semua signing terjadi lokal, hanya signature dikirim ke server.
- **File permissions:** vault otomatis chmod 600 — hanya owner yang bisa baca.

### Heartbeat Timing

- Daemon mengirim heartbeat tiap **30 detik**.
- Server mempertimbangkan Anda "active" selama **90 detik** terakhir (lihat `HEARTBEAT_FRESHNESS_SECONDS` di `identity.ts`).
- Jadi ada buffer 60 detik — kalau satu heartbeat gagal, masih dihitung aktif sampai 90s berlalu.

### Leader-Proposal Mode

- **< 2 active external validators** → Vercel tetap self-produce block, top PoC score yang dikreditkan.
- **≥ 2 active external validators** → leader-proposal mode aktif. Block dipilih leader secara round-robin deterministic. Kalau termasuk dalam pilihan leader, Anda dapat chance eksekusi (tapi leader window hanya buat attestation di masa depan kalau mempool architecture di-wire, sekarang pun sudah dirancang siap).

### Troubleshooting

- **"SELF_CUSTODY_REQUIRED"** — jalankan CLI dulu supaya self-custody pubkey terdaftar.
- **"NOT_AN_ACTIVE_VALIDATOR"** — Anda bukan di `identity.validators` dengan `is_active=TRUE`. Cek:
  1. Apakah approved di `validator_candidates`?
  2. Apakah stake cukup besar buat masuk top-N PoC?
  3. Tunggu `runEpoch()` jalan (harian, biasanya tengah malam UTC).
- **Daemon kirim heartbeat tapi HTTP 403** — lihat error dari server. Mungkin ada timeout, ubah interval 30s jadi lebih sering, atau cek uptime server.

## Systemd Service Example

Supaya daemon otomatis restart kalau crash:

```ini
# /etc/systemd/system/eastchain-validator.service
[Unit]
Description=EastChain Validator Heartbeat Daemon
After=network.target

[Service]
Type=simple
User=eastchain
WorkingDirectory=/home/eastchain/eastchain-validator
Environment="EASTCHAIN_API_URL=https://your-app.vercel.app"
Environment="EASTCHAIN_TELEGRAM_ID=123456789"
Environment="EASTCHAIN_VAULT_PATH=/home/eastchain/.eastchain-validator-vault.json"
ExecStart=/usr/bin/node /home/eastchain/eastchain-validator/scripts/heartbeat-daemon.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Lalu:

```bash
sudo systemctl daemon-reload
sudo systemctl start eastchain-validator
sudo systemctl enable eastchain-validator
sudo journalctl -u eastchain-validator -f  # tail logs
```

## Questions?

Tanya ke tim — infrastructure validator ini masih fase awal, banyak edge case yang mungkin belum ter-cover.
