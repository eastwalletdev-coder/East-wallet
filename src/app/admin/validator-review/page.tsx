'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { CheckCircle, XCircle, Clock, Loader2, LogOut } from 'lucide-react';

interface ValidatorCandidate {
  telegram_id: string;
  public_key: string;
  status: 'pending_review' | 'approved' | 'rejected';
  submitted_at: string;
  reviewed_at?: string;
  reviewed_by?: string;
  notes: string;
}

declare global {
  interface Window {
    onTelegramAuth?: (user: any) => void;
  }
}

// Reuses the same bot username already configured for the Mini App itself.
const BOT_USERNAME = process.env.NEXT_PUBLIC_BOT_USERNAME || 'Eastnetwork_bot';

type AuthState = 'checking' | 'signed_out' | 'signed_in' | 'forbidden';

export default function ValidatorReviewPage() {
  const [candidates, setCandidates] = useState<ValidatorCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [suspiciousResets, setSuspiciousResets] = useState<any[]>([]);
  const [filter, setFilter] = useState<'pending_review' | 'all'>('pending_review');
  const [authState, setAuthState] = useState<AuthState>('checking');
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [migrating, setMigrating] = useState<string | null>(null);
  // Second factor for genesis-reset AND every migration trigger — see
  // verifyDestructivePassphrase's doc comment in admin-auth.ts. Kept as
  // plain component state (never persisted, cleared on reload) — this is
  // deliberately NOT saved to localStorage/cookies alongside the session.
  const [destructivePassphrase, setDestructivePassphrase] = useState('');
  const [migrationResult, setMigrationResult] = useState<{ endpoint: string; success: boolean; message: string } | null>(null);
  const [backfillTelegramId, setBackfillTelegramId] = useState('');
  const [backfillRunning, setBackfillRunning] = useState(false);
  const [backfillResult, setBackfillResult] = useState<any>(null);
  const [resetConfirmInput, setResetConfirmInput] = useState('');
  const [resetRunning, setResetRunning] = useState(false);
  const [resetResult, setResetResult] = useState<any>(null);
  const widgetContainerRef = useRef<HTMLDivElement>(null);

  const fetchCandidates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/validator-candidates?status=${filter === 'all' ? '' : 'pending_review'}`);
      if (res.ok) {
        const data = await res.json();
        setCandidates(data.candidates || []);
        setAuthState('signed_in');
      } else if (res.status === 401) {
        setAuthState('signed_out');
      } else if (res.status === 403) {
        setAuthState('forbidden');
      }
    } catch (err) {
      console.error('[EASTCHAIN] fetchCandidates error:', err);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  // On mount: probe whether we already have a valid session cookie (e.g.
  // page refresh after a prior Telegram login). Cookies are sent
  // automatically on same-origin fetches, no header needed.
  useEffect(() => {
    fetchCandidates();
    fetch('/api/admin/suspicious-full-nodes').then(r => r.json()).then(d => {
      if (d.success) setSuspiciousResets(d.rows || []);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (authState === 'signed_in') fetchCandidates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  // Wire up the Telegram Login Widget callback.
  useEffect(() => {
    window.onTelegramAuth = async (user: any) => {
      setAuthState('checking');
      try {
        const res = await fetch('/api/admin/telegram-login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(user),
        });
        if (res.ok) {
          setAuthState('signed_in');
          fetchCandidates();
        } else if (res.status === 403) {
          setAuthState('forbidden');
        } else {
          setAuthState('signed_out');
        }
      } catch {
        setAuthState('signed_out');
      }
    };
    return () => {
      window.onTelegramAuth = undefined;
    };
  }, [fetchCandidates]);

  // Inject Telegram Login Widget after signed_out paint (ref must exist).
  // Retry: first effect tick often runs before ref is attached → empty UI.
  useEffect(() => {
    if (authState !== 'signed_out' && authState !== 'forbidden') return;
    if (!BOT_USERNAME) return;

    let cancelled = false;

    const inject = (): boolean => {
      const el = widgetContainerRef.current;
      if (!el || cancelled) return false;
      el.innerHTML = '';
      const script = document.createElement('script');
      script.src = 'https://telegram.org/js/telegram-widget.js?22';
      script.async = true;
      script.setAttribute('data-telegram-login', BOT_USERNAME);
      script.setAttribute('data-size', 'large');
      script.setAttribute('data-radius', '10');
      script.setAttribute('data-onauth', 'onTelegramAuth(user)');
      script.setAttribute('data-request-access', 'write');
      // Light button so it stays visible on dark app chrome
      script.setAttribute('data-userpic', 'false');
      el.appendChild(script);
      return true;
    };

    let frames = 0;
    const raf = () => {
      if (cancelled) return;
      if (inject()) return;
      if (frames++ < 30) requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);
    const t1 = window.setTimeout(() => inject(), 50);
    const t2 = window.setTimeout(() => inject(), 300);
    const t3 = window.setTimeout(() => inject(), 1000);

    return () => {
      cancelled = true;
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, [authState]);


  async function handleLogout() {
    await fetch('/api/admin/logout', { method: 'POST' });
    setAuthState('signed_out');
    setCandidates([]);
  }

  async function handleReview(telegramId: string, decision: 'approved' | 'rejected') {
    setReviewingId(telegramId);
    try {
      const res = await fetch('/api/admin/validator-candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramId, decision, notes: reviewNotes }),
      });
      if (res.ok) {
        setReviewNotes('');
        fetchCandidates();
      } else {
        const err = await res.json();
        alert(`Error: ${err.error}`);
      }
    } catch (err) {
      alert(`Error: ${(err as any).message}`);
    } finally {
      setReviewingId(null);
    }
  }

  if (authState === 'checking') {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (authState === 'signed_out' || authState === 'forbidden') {
    return (
      <div className="max-w-md mx-auto p-6 space-y-4 text-center text-white">
        <h1 className="text-2xl font-bold">Validator Review (Admin Only)</h1>
        <p className="text-sm text-white/50">
          Log in with the founder&apos;s Telegram account. No password — identity is
          verified directly by Telegram, and only telegram_ids listed
          in FOUNDER_IDS are allowed in.
        </p>
        {authState === 'forbidden' && (
          <p className="text-sm text-red-400 font-medium">
            This Telegram account is not a founder — access denied.
          </p>
        )}
        {/* min-height so empty inject is obvious; Telegram script fills this */}
        <div
          ref={widgetContainerRef}
          className="flex justify-center items-center py-6 min-h-[56px] rounded-xl bg-white/5 border border-white/10"
        />
        {!BOT_USERNAME ? (
          <p className="text-xs text-red-400">
            NEXT_PUBLIC_BOT_USERNAME is not set at build time — the widget cannot load.
            Set it on Vercel and <strong>redeploy</strong> (NEXT_PUBLIC_* is inlined at build).
          </p>
        ) : (
          <p className="text-[11px] text-white/40">
            Bot: <span className="font-mono text-white/60">@{BOT_USERNAME}</span>
            {' '}· If the button below is missing, open this page in Chrome/Safari
            (not only in-app WebView), allow third-party cookies, and confirm BotFather
            Login Widget domain includes <span className="font-mono">thiseast.vercel.app</span>.
          </p>
        )}
      </div>
    );
  }

  const MIGRATIONS = [
    { path: '/api/admin/migrate-leader-schedule', label: 'Leader Schedule + Real Production + R2/Signing' },
    { path: '/api/admin/migrate-self-custody', label: 'Self-Custody v8' },
    { path: '/api/admin/backfill-keypairs', label: 'Backfill Keypairs' },
    { path: '/api/admin/migrate-lightnode-epoch', label: 'Light Node Epoch Reward (v12)' },
    { path: '/api/admin/migrate-evm-link', label: 'EVM Link Column (v5) — secp256k1 dual-path auth' },
    { path: '/api/admin/migrate-evm-self-custody', label: 'EVM Self-Custody Columns (v13) — wallet_type/evm_public_key' },
    { path: '/api/admin/migrate-unstake-delay', label: 'Unstake Claim Delay Columns (v14) — pending_unstake_amount/claimable_at' },
    { path: '/api/admin/migrate-governance-schema', label: 'Contract Governance Schema — proposals/votes/approved_functions' },
    { path: '/api/admin/migrate-full-node-schema', label: 'Full Node Agreements Schema — full_node_agreements' },
  ];

  const runMigration = async (path: string) => {
    if (!destructivePassphrase) {
      setMigrationResult({ endpoint: path, success: false, message: 'Enter the admin passphrase first.' });
      return;
    }
    setMigrating(path);
    setMigrationResult(null);
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passphrase: destructivePassphrase }), // browser sends the session cookie automatically too
      });
      const data = await res.json();
      setMigrationResult({ endpoint: path, success: res.ok && data.success, message: data.message || data.error || 'Unknown response' });
    } catch (err: any) {
      setMigrationResult({ endpoint: path, success: false, message: err.message });
    } finally {
      setMigrating(null);
    }
  };

  // Backfill orphaned Recent Activity rows for a user who upgraded to
  // self-custody EVM (see /api/admin/backfill-tx-addresses). Always runs
  // dryRun first so you see what WOULD change before writing anything.
  const runBackfill = async (dryRun: boolean) => {
    setBackfillRunning(true);
    if (dryRun) setBackfillResult(null);
    try {
      const res = await fetch('/api/admin/backfill-tx-addresses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          telegramId: backfillTelegramId.trim() || undefined,
          dryRun,
        }),
      });
      const data = await res.json();
      setBackfillResult(data);
    } catch (err: any) {
      setBackfillResult({ success: false, error: err.message });
    } finally {
      setBackfillRunning(false);
    }
  };

  // Extremely destructive — must match /api/admin/genesis-reset's CONFIRM_PHRASE
  // exactly (server re-checks it too, this is just so the button can't be
  // clicked by accident before the phrase is even typed).
  const RESET_CONFIRM_PHRASE = 'RESET_EVERYTHING_I_UNDERSTAND';

  const runGenesisReset = async () => {
    if (resetConfirmInput !== RESET_CONFIRM_PHRASE) return;
    if (!destructivePassphrase) {
      setResetResult({ success: false, message: 'Enter the admin passphrase first.' });
      return;
    }
    if (!window.confirm(
      'This wipes ALL blocks, transactions, mempool, staking positions, and mint counters, ' +
      'then restores balances from a snapshot. Founder vesting resets to a fresh 12-month cliff. ' +
      'This cannot be undone. Proceed?'
    )) return;

    setResetRunning(true);
    setResetResult(null);
    try {
      const res = await fetch('/api/admin/genesis-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: resetConfirmInput, passphrase: destructivePassphrase }), // browser sends the session cookie automatically
      });
      const data = await res.json();
      setResetResult({ success: res.ok && data.success, message: data.message || data.error || 'Unknown response', raw: data });
      if (res.ok && data.success) setResetConfirmInput('');
    } catch (err: any) {
      setResetResult({ success: false, message: err.message });
    } finally {
      setResetRunning(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Validator Candidate Review</h1>
        <div className="flex items-center gap-2">
          <Button
            variant={filter === 'pending_review' ? 'default' : 'outline'}
            onClick={() => setFilter('pending_review')}
            size="sm"
          >
            Pending
          </Button>
          <Button
            variant={filter === 'all' ? 'default' : 'outline'}
            onClick={() => setFilter('all')}
            size="sm"
          >
            All
          </Button>
          <Button variant="ghost" size="sm" onClick={handleLogout} title="Logout">
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="border-2 border-amber-300 rounded-lg p-3 bg-amber-50 space-y-2">
        <h2 className="text-xs font-semibold text-amber-800">🔑 Admin Passphrase</h2>
        <p className="text-[11px] text-amber-700">
          Required for Migrations below and Genesis Reset further down — a second factor
          independent of your Telegram login, so a compromised Telegram session alone
          can't trigger either. Not saved anywhere; re-enter each visit.
        </p>
        <input
          type="password"
          placeholder="Admin passphrase"
          value={destructivePassphrase}
          onChange={(e) => setDestructivePassphrase(e.target.value)}
          className="w-full px-3 py-2 text-xs border border-amber-300 rounded font-mono"
          autoComplete="off"
        />
      </div>

      <div className="border rounded-lg p-4 space-y-3 bg-gray-50">
        <h2 className="text-sm font-semibold text-gray-700">Migrations</h2>
        <p className="text-xs text-gray-500">
          Runs directly from this browser session — no curl/cookie copying needed.
        </p>
        <div className="grid gap-2">
          {MIGRATIONS.map((m) => (
            <Button
              key={m.path}
              variant="outline"
              size="sm"
              disabled={migrating === m.path}
              onClick={() => runMigration(m.path)}
              className="justify-start text-xs h-auto py-2"
            >
              {migrating === m.path ? (
                <Loader2 className="w-3 h-3 mr-2 animate-spin" />
              ) : (
                <span className="mr-2">▶</span>
              )}
              {m.label}
            </Button>
          ))}
        </div>
        {migrationResult && (
          <div className={`text-xs p-2 rounded ${migrationResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
            <p className="font-mono text-[10px] opacity-70">{migrationResult.endpoint}</p>
            <p>{migrationResult.message}</p>
          </div>
        )}
      </div>

      <div className="border rounded-lg p-4 space-y-3 bg-gray-50">
        <h2 className="text-sm font-semibold text-gray-700">Backfill Recent Activity (post-EVM-migration)</h2>
        <p className="text-xs text-gray-500">
          Fixes old send/receive history disappearing after a user upgrades to self-custody EVM.
          Leave Telegram ID empty to run against every migrated user. Always run "Dry Run" first
          and check the result before "Apply".
        </p>
        <input
          type="text"
          placeholder="Telegram ID (optional — empty = all users)"
          value={backfillTelegramId}
          onChange={(e) => setBackfillTelegramId(e.target.value)}
          className="w-full px-3 py-2 text-xs border rounded font-mono"
        />
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={backfillRunning}
            onClick={() => runBackfill(true)}
            className="text-xs"
          >
            {backfillRunning ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : null}
            Dry Run
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={backfillRunning || !backfillResult?.dryRun}
            onClick={() => runBackfill(false)}
            className="text-xs"
            title={!backfillResult?.dryRun ? 'Run Dry Run first' : ''}
          >
            {backfillRunning ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : null}
            Apply (writes to DB)
          </Button>
        </div>
        {backfillResult && (
          <div className={`text-xs p-2 rounded space-y-1 ${backfillResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
            <p>
              {backfillResult.dryRun ? 'DRY RUN — nothing written yet.' : 'APPLIED — written to DB.'}{' '}
              {backfillResult.usersWithMatches ?? 0} user(s) affected, {backfillResult.totalRowsMatched ?? backfillResult.totalRowsUpdated ?? 0} row(s) matched.
            </p>
            {backfillResult.error && <p className="font-mono text-[10px]">{backfillResult.error}</p>}
            {backfillResult.details?.length > 0 && (
              <pre className="text-[9px] overflow-x-auto bg-white/50 p-2 rounded max-h-40 overflow-y-auto">
                {JSON.stringify(backfillResult.details, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>

      {suspiciousResets.length > 0 && (
        <div className="border-2 border-amber-300 rounded-lg p-4 space-y-2 bg-amber-50">
          <h2 className="text-sm font-semibold text-amber-800">⚠ Flagged Full Node Height Regressions</h2>
          <p className="text-xs text-amber-700">
            Detection only — no automatic action taken. Review manually. See identity.ts's
            full_node_sync_attestations doc comment for how these are flagged.
          </p>
          <div className="space-y-1.5">
            {suspiciousResets.map((row) => (
              <div key={row.id} className="text-xs bg-white/60 rounded p-2 font-mono">
                <span className="font-bold">{row.wallet_address}</span> — dropped to height {row.height}
                {' '}at {new Date(row.created_at).toLocaleString()}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="border-2 border-red-300 rounded-lg p-4 space-y-3 bg-red-50">
        <h2 className="text-sm font-semibold text-red-700">⚠ Danger Zone — Genesis Reset</h2>
        <p className="text-xs text-red-600">
          Wipes ALL blocks, transactions, mempool, staking positions, and mint counters, then
          restores every balance from a snapshot. Founder vesting resets to a fresh 12-month cliff.
          <strong> This cannot be undone.</strong> Type <code className="font-mono bg-red-100 px-1 rounded">{RESET_CONFIRM_PHRASE}</code> below to enable the button.
        </p>
        <input
          type="text"
          placeholder={RESET_CONFIRM_PHRASE}
          value={resetConfirmInput}
          onChange={(e) => setResetConfirmInput(e.target.value)}
          className="w-full px-3 py-2 text-xs border border-red-300 rounded font-mono"
        />
        <Button
          variant="destructive"
          size="sm"
          disabled={resetRunning || resetConfirmInput !== RESET_CONFIRM_PHRASE || !destructivePassphrase}
          onClick={runGenesisReset}
          className="text-xs"
        >
          {resetRunning ? <Loader2 className="w-3 h-3 mr-2 animate-spin" /> : null}
          Execute Genesis Reset
        </Button>
        {resetResult && (
          <div className={`text-xs p-2 rounded ${resetResult.success ? 'bg-green-50 text-green-700' : 'bg-red-100 text-red-700'}`}>
            <p>{resetResult.message}</p>
            {resetResult.raw && (
              <pre className="text-[9px] overflow-x-auto bg-white/50 p-2 rounded max-h-40 overflow-y-auto mt-1">
                {JSON.stringify(resetResult.raw, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : candidates.length === 0 ? (
        <p className="text-gray-500 text-center py-12">No candidates found.</p>
      ) : (
        <div className="space-y-4">
          {candidates.map((c) => (
            <div key={c.telegram_id} className="border rounded-lg p-4 space-y-3">
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-mono text-sm font-bold">{c.telegram_id}</p>
                  <p className="text-xs text-gray-500 font-mono break-all">{c.public_key}</p>
                </div>
                <div className="flex gap-2">
                  {c.status === 'pending_review' && <Clock className="w-4 h-4 text-yellow-500" />}
                  {c.status === 'approved' && <CheckCircle className="w-4 h-4 text-green-500" />}
                  {c.status === 'rejected' && <XCircle className="w-4 h-4 text-red-500" />}
                  <span className="text-xs font-semibold uppercase">{c.status}</span>
                </div>
              </div>

              <div className="text-xs text-gray-600 space-y-1">
                <p>Submitted: {new Date(c.submitted_at).toLocaleString()}</p>
                {c.reviewed_at && (
                  <>
                    <p>Reviewed: {new Date(c.reviewed_at).toLocaleString()}</p>
                    <p>By: {c.reviewed_by}</p>
                  </>
                )}
                {c.notes && <p>Notes: {c.notes}</p>}
              </div>

              {c.status === 'pending_review' && (
                <div className="space-y-2 pt-2 border-t">
                  <textarea
                    placeholder="Review notes (optional)"
                    value={reviewingId === c.telegram_id ? reviewNotes : ''}
                    onChange={(e) => setReviewNotes(e.target.value)}
                    className="w-full px-3 py-2 text-xs border rounded"
                    rows={2}
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={reviewingId === c.telegram_id}
                      onClick={() => handleReview(c.telegram_id, 'rejected')}
                    >
                      {reviewingId === c.telegram_id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Reject'}
                    </Button>
                    <Button
                      size="sm"
                      disabled={reviewingId === c.telegram_id}
                      onClick={() => handleReview(c.telegram_id, 'approved')}
                    >
                      {reviewingId === c.telegram_id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Approve'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
