// GET /api/admin/migrated-addresses
//
// Read-only helper for the manual emergency chain-state backup procedure
// (used while /admin/snapshot on the validator is unavailable — old
// deployed build, or CHAIN_BACKUP_URL fallback isn't wired up yet).
//
// Returns every wallet address that has (or may have) real on-chain
// activity — i.e. self-custody migrated users, whose balance now lives
// authoritatively on the validator chain (USE_CHAIN_BALANCE=true), not
// in identity.users.balance. A Termux/shell script can loop this list
// against the validator's GET /account/{address} (already live, no auth,
// no code changes needed) to compile a manual backup file.
//
// Founder-auth gated (read-only, so no destructive passphrase needed).
import { NextRequest, NextResponse } from 'next/server';
import { identityPool } from '@/lib/db/identity';
import { requireFounderAuth } from '@/lib/admin-auth';

export async function GET(req: NextRequest) {
  const auth = requireFounderAuth(req);
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });

  const client = await identityPool.connect();
  try {
    const res = await client.query(
      `SELECT telegram_id, wallet_address
         FROM identity.users
        WHERE wallet_type = 'self_custody_evm'
          AND evm_wallet_migrated_at IS NOT NULL
          AND wallet_address IS NOT NULL
        ORDER BY evm_wallet_migrated_at ASC`,
    );
    return NextResponse.json({
      ok: true,
      count: res.rows.length,
      addresses: res.rows.map((r) => r.wallet_address),
    });
  } catch (err: unknown) {
    console.error('[EASTCHAIN] migrated-addresses query failed:', err);
    return NextResponse.json({ ok: false, error: 'query_failed' }, { status: 500 });
  } finally {
    client.release();
  }
}
