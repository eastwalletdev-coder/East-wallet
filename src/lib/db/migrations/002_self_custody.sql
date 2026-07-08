-- EASTCHAIN — Migration 002: Self-custody + validator candidacy
-- Safe to run multiple times (IF NOT EXISTS guards throughout).
--
-- What this does:
--   1. Lets a user register a public key they hold themselves (generated
--      client-side, never touches the server) as proof of self-custody —
--      separate from the deterministic server-derived EAST keypair.
--   2. Adds a validator-candidate table so users can apply to become a
--      validator once they're self-custodial. Candidates start as
--      'pending_review' — this project is admin-approved for now, not
--      permissionless, and that's an intentional, honest constraint.
--
-- Run manually against DATABASE_IDENTITY_URL, e.g.:
--   psql "$DATABASE_IDENTITY_URL" -f src/lib/db/migrations/002_self_custody.sql

-- 1. Self-custody fields on the existing users table
ALTER TABLE identity.users
  ADD COLUMN IF NOT EXISTS self_custody_pubkey VARCHAR(128),
  ADD COLUMN IF NOT EXISTS self_custody_migrated_at TIMESTAMPTZ;

-- One pubkey should not be claimed by two different accounts
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_self_custody_pubkey
  ON identity.users (self_custody_pubkey)
  WHERE self_custody_pubkey IS NOT NULL;

-- 2. Validator candidacy table
--    Distinct from identity.validators (which tracks *active, scored*
--    validators for the epoch engine). This table is the intake/approval
--    queue that feeds into it.
CREATE TABLE IF NOT EXISTS identity.validator_candidates (
  telegram_id VARCHAR(50) PRIMARY KEY REFERENCES identity.users(telegram_id),
  public_key VARCHAR(128) NOT NULL,
  signature VARCHAR(256) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending_review', -- pending_review | approved | rejected
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by VARCHAR(50),
  notes TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_validator_candidates_status
  ON identity.validator_candidates (status);
