# Early bird 200 EAST (first 10k) + mandatory channel join

## Features
1. **Channel gate** — Mini App blocked until user is member of `@Eastnetwork`
2. **Early bird** — first **10,000** `identity.users` get **+200 EAST** on Neon balance (once)

## Env
```
TELEGRAM_BOT_TOKEN=...                 # required; bot = admin of the channel
NEXT_PUBLIC_REQUIRED_CHANNEL=@Eastnetwork
EARLY_BIRD_USER_LIMIT=10000
EARLY_BIRD_BONUS_EAST=200
```

## Deploy files
- `src/lib/telegram-channel.ts`
- `src/lib/early-bird.ts`
- `src/actions/channel-gate-actions.ts`
- `src/components/ChannelJoinGate.tsx`
- `src/app/layout.tsx` (wraps app)
- `src/actions/wallet-onboarding-actions.ts` (bonus on create)
- `src/actions/mining-actions.ts` (bonus on legacy register)
- `src/app/api/admin/migrate-early-bird/route.ts`

Run migrate-early-bird once (adds `early_bird_bonus` column).

## Notes
- Bonus is **Neon mining ledger**, not validator Badger.
- Channel check uses Bot API `getChatMember` — bot must be **administrator** of the channel.
- Outside Telegram (no userId), gate is skipped for local testing.
