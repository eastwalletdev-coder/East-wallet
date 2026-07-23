-- EASTCHAIN — Migration 004: case-insensitive index for wallet_address lookups
-- Safe to run multiple times (IF NOT EXISTS guard).
--
-- Why: sendEast() (mining-actions.ts) now looks recipients up via
-- LOWER(wallet_address) = $1, because self_custody_evm addresses are
-- stored checksummed (mixed-case) while legacy custodial_hash addresses
-- are always lowercase hex. The existing UNIQUE index on wallet_address
-- only covers the raw (case-sensitive) value, so without this the new
-- lookup falls back to a sequential scan. This index makes it fast again.
--
-- Run manually against DATABASE_IDENTITY_URL, e.g.:
--   psql "$DATABASE_IDENTITY_URL" -f src/lib/db/migrations/004_wallet_address_case_insensitive_index.sql

CREATE INDEX IF NOT EXISTS idx_users_wallet_address_lower
  ON identity.users (LOWER(wallet_address));
