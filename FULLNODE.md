# Browser full lightnode

## Why it would not turn on before
`FullNodeConsentDialog` and `setFullNodeEnabled()` existed, but **Home never called them** — no button / no wiring.

## What browser full mode is
| Feature | Browser full lightnode | Termux `full-node-sync.js` |
|---------|------------------------|----------------------------|
| Balance replica (Hub RPC) | Yes (`balance:update`) | Yes |
| Answer `rpc_balance_request` | Yes | Yes |
| Full historical blocks on disk | Limited (IndexedDB headers) | Stronger local ledger |
| Advertise `nodeType: "full"` | Yes | Yes (`hasFullLedger`) |

This is **not** a second Railway validator. It is an opt-in lightnode that keeps balances and can serve read RPC via the Hub.

## UI
Home → **Enable full lightnode** → consent dialog → agreement recorded → `client.setFullNodeEnabled(true)` → WebSocket reconnect with `nodeType: "full"`.

Requires Telegram `initData` for `agreeToFullNodeTerms` / `setFullNodeActiveStatus`.
