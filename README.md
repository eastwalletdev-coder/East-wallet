# Full lightnode: IndexedDB balance replica

## Behaviour (same features, durable)
| Layer | Role |
|-------|------|
| **Memory Map** | Hot path — `rpc_balance_request` answers (unchanged) |
| **IndexedDB** | Cold path — survives reload / Mini App reopen |
| **Debounced writes** | ~800ms batch — less IO than write-per-update |
| **Soft cap** | 50k accounts; oldest by `updatedAt` pruned if exceeded |

## Lifecycle
1. User enables fullnode → `setFullNodePref(true)` + hydrate from IDB
2. `balance:update` → Map + debounced IDB put
3. Disable → clear Map + clear IDB store + pref false
4. Reload with pref true → auto `fullNodeEnabled` + hydrate before Hub updates

## Files
- `src/lib/lightnode/balance-replica-store.ts` (new)
- `src/lib/lightnode/client.ts` (wired)

Not a full block archive — balance replica only, same as current design.
