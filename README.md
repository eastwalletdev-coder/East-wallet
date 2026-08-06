# Home activity + Wallet activity + Full lightnode (one deploy)

## Build fix
`src/app/page.tsx` imports:
```ts
import { getLightNodeClient, type LightNodeState } from "@/lib/lightnode/client";
```
(Fixes: Cannot find name `LightNodeState`)

## Includes
| File | What |
|------|------|
| `src/app/page.tsx` | Recent Activity + Enable full lightnode |
| `src/app/wallet/page.tsx` | Activity tab (Pending / Confirmed) |
| `src/components/SendDialog.tsx` | Local activity status `confirmed` |
| `src/components/FullNodeConsentDialog.tsx` | Consent UI |
| `src/lib/chain-activity-local.ts` | Device activity log |
| `src/lib/lightnode/client.ts` | Archive catch-up fix + setFullNodeEnabled |
| `src/actions/full-node-actions.ts` | Agreement / active flag (if missing in repo) |
| `src/lib/transaction-service.ts` | Optional Neon pending/history |

## Deploy
Merge into East-wallet `src/…`, push, redeploy Vercel.

Full lightnode: connect Light Node first → **Enable full lightnode**.
