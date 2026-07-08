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
const BOT_USERNAME = process.env.NEXT_PUBLIC_BOT_USERNAME;

type AuthState = 'checking' | 'signed_out' | 'signed_in' | 'forbidden';

export default function ValidatorReviewPage() {
  const [candidates, setCandidates] = useState<ValidatorCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'pending_review' | 'all'>('pending_review');
  const [authState, setAuthState] = useState<AuthState>('checking');
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
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

  // Inject the official Telegram widget script once we know we need it.
  useEffect(() => {
    if (authState !== 'signed_out' && authState !== 'forbidden') return;
    if (!widgetContainerRef.current || !BOT_USERNAME) return;
    widgetContainerRef.current.innerHTML = '';

    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.setAttribute('data-telegram-login', BOT_USERNAME);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-onauth', 'onTelegramAuth(user)');
    script.setAttribute('data-request-access', 'write');
    widgetContainerRef.current.appendChild(script);
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
      <div className="max-w-md mx-auto p-6 space-y-4 text-center">
        <h1 className="text-2xl font-bold">Validator Review (Admin Only)</h1>
        <p className="text-sm text-gray-500">
          Login pakai akun Telegram founder. Tidak ada password — identitas
          diverifikasi langsung oleh Telegram, dan hanya telegram_id yang ada
          di FOUNDER_IDS yang diizinkan masuk.
        </p>
        {authState === 'forbidden' && (
          <p className="text-sm text-red-500 font-medium">
            Akun Telegram ini bukan founder — akses ditolak.
          </p>
        )}
        <div ref={widgetContainerRef} className="flex justify-center py-4" />
        {!BOT_USERNAME && (
          <p className="text-xs text-red-500">
            NEXT_PUBLIC_BOT_USERNAME belum di-set — widget tidak bisa dimuat.
          </p>
        )}
      </div>
    );
  }

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
