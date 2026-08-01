# Wire Phase 3 into wallet-onboarding-actions.ts

In `src/actions/wallet-onboarding-actions.ts`:

```ts
import { applyChainBalanceToUser } from '@/lib/chain-balance';
```

Wherever you `return { ok: true, user: mapUserRow(...) }` (or similar), change to:

```ts
const user = mapUserRow(row, eastId);
return { ok: true, user: await applyChainBalanceToUser(user) };
```

Do this for every path that returns the user object used by the dashboard balance
(getOrCreateUser / getUserProfile / etc.).

Behavior:
- `USE_CHAIN_BALANCE` not `true` → still Neon (`balanceSource: "neon"`)
- Flag on + Hub/validator OK → overwrites balance/staked from chain
- Flag on + chain down → keeps Neon numbers (`balanceSource: "neon_fallback"`)
