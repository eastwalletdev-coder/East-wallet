# Wire early-bird + channel gate

## Env (Vercel)
```
TELEGRAM_BOT_TOKEN=...          # BotFather — bot must be **admin** of @Eastnetwork
NEXT_PUBLIC_REQUIRED_CHANNEL=@Eastnetwork
EARLY_BIRD_USER_LIMIT=10000     # optional, default 10000
EARLY_BIRD_BONUS_EAST=200       # optional, default 200
```

## 1. DB migration (once)
Admin → migrate OR:
```
POST /api/admin/migrate-early-bird  + founder session + passphrase
```

## 2. `createSelfCustodyWallet` (wallet-onboarding-actions.ts)
After successful INSERT of new user, still inside the transaction:

```ts
import { grantEarlyBirdBonusIfEligible } from '@/lib/early-bird';
// ...
const bird = await grantEarlyBirdBonusIfEligible(client, telegramId);
```

Then re-SELECT user before COMMIT so returned balance includes the bonus.

## 3. `registerOrUpdateUser` (mining-actions.ts)
Only on first insert path (when ON CONFLICT did not update an existing row).
Safest: after INSERT, call `grantEarlyBirdBonusIfEligible` — function is idempotent via `early_bird_bonus` flag.

## 4. `layout.tsx`
```tsx
import { ChannelJoinGate } from '@/components/ChannelJoinGate';
// wrap children:
<ChannelJoinGate>
  <main>...</main>
</ChannelJoinGate>
```

## Note
Bonus credits **Neon identity.users.balance** (mining ledger), not validator Badger.
Users who want on-chain balance still use Deposit / migrate.
