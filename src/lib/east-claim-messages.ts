/**
 * EASTCHAIN — Canonical claim message builders
 * ─────────────────────────────────────────────────────────────────────
 * Plain, isomorphic module (no 'use client' / 'use server' directive) —
 * safe to import from both browser components (to sign) and server
 * actions (to verify). Both sides MUST build the exact same string or
 * signature verification will always fail, so this is the single source
 * of truth for the format instead of duplicating it in two places.
 */

export function buildSelfCustodyClaimMessage(telegramId: string, pubkeyHex: string): string {
  return `SELF_CUSTODY_CLAIM|${telegramId}|${pubkeyHex}`;
}

export function buildValidatorClaimMessage(telegramId: string, pubkeyHex: string): string {
  return `REGISTER_VALIDATOR|${telegramId}|${pubkeyHex}`;
}
