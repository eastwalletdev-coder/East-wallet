# Combined: leader push + STUN + PEER_OFFLINE warn + migrate activity

## Includes
1. **Leader push** — block:new → broadcast mesh; non-leader range only parent
2. **STUN pool** — Google 0–4, Cloudflare, stunprotocol; ICE grace 10s
3. **PEER_OFFLINE** → warn "not on hub (P2P may still be up)"
4. **Migrate to chain** in Recent Activity when Home deposit (Neon → on-chain) succeeds

## Files
- `src/lib/lightnode/client.ts`
- `src/lib/lightnode/webrtc-peer.ts`
- `src/lib/chain-activity-local.ts` (type `migrate`)
- `src/app/page.tsx` (pushLocalActivity on deposit)
- `src/app/wallet/page.tsx` (label/icon)
- `src/components/SendDialog.tsx` (if present)

## Deploy
Merge into East-wallet `src/…` → push Vercel.
