# EASTCHAIN — Hybrid Chain Mining Platform

> One Smartphone, One Node, One Future

A Telegram Mini App with hybrid blockchain ledger, mobile mining, EASTPASS staking tiers, referral system, and block explorer.

## Architecture

```
Telegram Mini App (Next.js 15)
    ↓
Identity Layer — NeonDB A        Ledger Layer — NeonDB B
  identity.users                   ledger.blocks (active chain)
  identity.validators              ledger.supply_buckets
  identity.referrals               ledger.chain_meta
  identity.archive_blocks          ledger.checkpoints
  identity.consensus_votes         ledger.staking_positions
    ↓
Cache Layer — Upstash Redis
  claim cooldown (24h)
  network status
  top 10 validators snapshot
```

## Environment Variables

Copy `.env.example` → `.env.local`:

```
DATABASE_IDENTITY_URL=    ← NeonDB Project A connection string
DATABASE_LEDGER_URL=      ← NeonDB Project B connection string
TELEGRAM_BOT_TOKEN=       ← From @BotFather
NEXT_PUBLIC_BOT_USERNAME= ← Bot username (without @)
WALLET_ADDRESS_SALT=      ← Random secret string
FOUNDER_IDS=              ← Comma-separated Telegram User IDs
UPSTASH_REDIS_REST_URL=   ← From Upstash dashboard
UPSTASH_REDIS_REST_TOKEN= ← From Upstash dashboard
NODE_ENV=production
```

## Deployment (Vercel)

1. Create 2 Neon projects: `east-identity` and `east-ledger`
2. Create 1 Upstash Redis database (free tier)
3. Connect repo to Vercel → set all env vars
4. Deploy — schemas auto-initialize on first cold start
5. Set bot Menu Button URL to your Vercel deployment URL in @BotFather

## Key Features

- **Wallet**: Deterministic `0x...` address from Telegram User ID
- **Mining**: 10 EAST base reward × tier boost, 24h rolling cooldown
- **EASTPASS Tiers**: Novice → Basic (2x) → Pro (4x) → Elite (7x) → Galaxy (10x)
- **Referral**: 1 EAST/referral (auto via deep link), max 5,000 EAST lifetime
- **Block Explorer**: Real-time active blocks + cold storage archive fallback
- **Anchor Protocol**: SHA-256 chain integrity + manipulation detection
- **Fault Recovery**: Simplified BFT (7/10 validators), gossip via Telegram

## Referral Deep Link

```
https://t.me/{BOT_USERNAME}?start={telegramUserId}
```

## Chain Properties

- Genesis: created on first ever mining claim
- Chain: SHA-256 hash chaining with `block_index + prev_hash`
- Archive: blocks > 30 days rolled to `identity.archive_blocks`
- Supply: hard-capped per bucket, enforced atomically server-side
