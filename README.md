# Fullnode enable + activity + admin migration

## Why "Full node enable failed" (Server Components digest)
`agreeToFullNodeTerms` / `setFullNodeActive` hit Postgres. If
`identity.full_node_agreements` was never created, the server action **throws**
and Next.js shows a generic Server Components error.

### Fix schema (once)
1. Open `/admin/validator-review`
2. Login with **founder** Telegram (widget needs `NEXT_PUBLIC_BOT_USERNAME`)
3. Enter **admin passphrase**
4. Run migration **Full node schema** (path `/api/admin/migrate-full-node-schema`)

Or curl (founder session cookie + passphrase):
```bash
curl -sS -X POST "https://APP/api/admin/migrate-full-node-schema" \
  -H "Content-Type: application/json" \
  -H "Cookie: YOUR_ADMIN_SESSION" \
  -d '{"passphrase":"YOUR_ADMIN_PASSPHRASE"}'
```

### Client resilience (this patch)
- DB errors return `{ success:false, error:'SCHEMA_MISSING' }` instead of throw
- UI can still enable **local** fullnode and show a clear English message

## Admin login not showing
Requires env:
```
NEXT_PUBLIC_BOT_USERNAME=YourBotUsername
```
Bot must match Telegram Login Widget domain. Only `FOUNDER_IDS` can sign in; others see forbidden.

## Wallet Activity
`defaultValue="activity"` so the Activity tab is visible; sources = mempool + local log + Neon history.

## Files
- `src/actions/full-node-actions.ts`
- `src/app/page.tsx` (from hardfix — enable handler)
- `src/app/wallet/page.tsx`
