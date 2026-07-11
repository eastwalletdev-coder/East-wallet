-- EASTCHAIN — Migration 003: EVM self-custody wallet onboarding
-- Safe to run multiple times (IF NOT EXISTS guards throughout).
--
-- What this does:
--   Adds columns to track WHICH kind of address a user's wallet_address
--   actually is:
--     - 'custodial_hash'  : legacy — SHA256(telegramId+salt) formatted to
--                           look like an address, no real keypair behind
--                           it. Grandfathered; still fully usable for
--                           mining/balance as before.
--     - 'self_custody_evm': real secp256k1 keypair generated client-side
--                           on m/44'/60'/0'/0/0, address = keccak256(pubkey).
--                           This is what NEW users get from first login,
--                           and what legacy users can voluntarily upgrade
--                           to via the "Upgrade to self-custody wallet"
--                           banner.
--
-- Run manually against DATABASE_IDENTITY_URL, e.g.:
--   psql "$DATABASE_IDENTITY_URL" -f src/lib/db/migrations/003_evm_self_custody.sql

ALTER TABLE identity.users
  ADD COLUMN IF NOT EXISTS wallet_type VARCHAR(24) NOT NULL DEFAULT 'custodial_hash',
  ADD COLUMN IF NOT EXISTS evm_public_key VARCHAR(132),
  ADD COLUMN IF NOT EXISTS evm_wallet_migrated_at TIMESTAMPTZ;

-- One EVM public key should not be claimed by two different accounts
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_evm_public_key
  ON identity.users (evm_public_key)
  WHERE evm_public_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_wallet_type
  ON identity.users (wallet_type);
