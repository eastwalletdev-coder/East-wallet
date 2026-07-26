// POST /api/admin/migrate-governance-schema — Runs migrateGovernanceSchema,
// which creates identity.contract_proposals, identity.contract_proposal_votes,
// and identity.approved_contract_functions. Needed before proposeFunction /
// voteOnProposal (governance-contract.ts, CONTRACTS.GOVERNANCE) can be
// called — those insert into these tables. Purely additive (CREATE TABLE IF
// NOT EXISTS), safe to call repeatedly. Admin-only, same auth pattern as the
// other /api/admin/migrate-* routes. Run this once before the governance
// contract goes live.
import { NextRequest, NextResponse } from 'next/server';
import { migrateGovernanceSchema } from '@/lib/db/identity';
import { requireFounderAuth, verifyDestructivePassphrase } from '@/lib/admin-auth';

export async function POST(req: NextRequest) {
  const auth = requireFounderAuth(req);
  if (!auth.ok) return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status });

  try {
    // Second, independent factor — see verifyDestructivePassphrase's doc
    // comment. A hijacked Telegram session alone is no longer sufficient
    // to run schema migrations.
    const body = await req.json().catch(() => ({}));
    const passOk = await verifyDestructivePassphrase(body?.passphrase, auth.telegramId || 'unknown');
    if (!passOk.ok) return NextResponse.json({ success: false, error: passOk.error }, { status: passOk.status });

    await migrateGovernanceSchema();
    return NextResponse.json({
      success: true,
      message: 'Governance schema applied: identity.contract_proposals / contract_proposal_votes / approved_contract_functions are ready.',
    });
  } catch (err: any) {
    console.error('[EASTCHAIN] migrate-governance-schema trigger error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
