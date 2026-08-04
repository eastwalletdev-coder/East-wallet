EAST-WALLET — combined patch (extract at repo root of East-wallet-main)
======================================================================

NEW
  src/lib/chain-tx.ts
  src/lib/chain-tx-client.ts
  src/app/api/chain/tx/route.ts
  docs/CHAIN_TX_VIA_HUB.md

MODIFIED
  src/app/page.tsx                  — EAST logo spacing (E further left); transfer-onchain copy (SQL, not Neon)
  src/app/wallet/page.tsx           — token row: amount top-right, USD below
  src/lib/token-service.ts          — unitPrice/value USD; EAST $0; chain balance fetch
  src/components/SendDialog.tsx     — optional on-chain send via Hub
  src/app/eastpass/page.tsx         — optional on-chain stake via Hub
  src/app/api/chain/transfer-onchain/route.ts — comments: database/SQL

Vercel env (for chain send/stake):
  RAILWAY_HUB_URL=https://your-hub.up.railway.app
  NEXT_PUBLIC_USE_CHAIN_TX=true
