'use client';

import { useState, useEffect } from 'react';
import { CheckCircle, Clock, AlertCircle, Loader2 } from 'lucide-react';

interface StatusData {
  timestamp: string;
  consensus: {
    mode: 'leader-proposal' | 'internal';
    activeExternalValidators: number;
    requiredForLeaderProposal: number;
    leaderProposalActive: boolean;
  };
  validators: Array<{ telegramId: string; score: number }>;
  heartbeatFreshness: string;
  info: string;
}

export default function ConsensusStatusPage() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchStatus = async () => {
    try {
      setError(null);
      const res = await fetch('/api/consensus/status');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.success) {
        setStatus(data);
      } else {
        throw new Error(data.error || 'Unknown error');
      }
    } catch (err) {
      setError((err as any).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    if (!autoRefresh) return;
    const interval = setInterval(fetchStatus, 30_000); // refresh every 30s
    return () => clearInterval(interval);
  }, [autoRefresh]);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto p-6 flex justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800 font-semibold">Error loading status</p>
          <p className="text-red-600 text-sm">{error}</p>
          <button
            onClick={fetchStatus}
            className="mt-2 text-red-700 underline text-sm"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!status) return null;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">EastChain Network Status</h1>
          <p className="text-xs text-gray-500 mt-1">Last updated: {new Date(status.timestamp).toLocaleString()}</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
            className="rounded"
          />
          Auto-refresh (30s)
        </label>
      </div>

      {/* Consensus Mode Card */}
      <div className={`border rounded-lg p-6 ${status.consensus.leaderProposalActive ? 'bg-green-50 border-green-200' : 'bg-blue-50 border-blue-200'}`}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2">
              {status.consensus.leaderProposalActive ? (
                <CheckCircle className="w-5 h-5 text-green-600" />
              ) : (
                <Clock className="w-5 h-5 text-blue-600" />
              )}
              Consensus Mode
            </h2>
            <p className={`text-sm mt-1 ${status.consensus.leaderProposalActive ? 'text-green-700' : 'text-blue-700'}`}>
              {status.info}
            </p>
          </div>
          <div className={`text-2xl font-bold uppercase tracking-wide ${status.consensus.leaderProposalActive ? 'text-green-600' : 'text-blue-600'}`}>
            {status.consensus.mode}
          </div>
        </div>
      </div>

      {/* Validator Summary */}
      <div className="grid grid-cols-2 gap-4">
        <div className="border rounded-lg p-4">
          <p className="text-xs text-gray-600 uppercase tracking-wider">Active External Validators</p>
          <p className="text-3xl font-bold mt-1">{status.consensus.activeExternalValidators}</p>
          <p className="text-xs text-gray-500 mt-2">Required for leader-proposal: {status.consensus.requiredForLeaderProposal}</p>
        </div>
        <div className="border rounded-lg p-4">
          <p className="text-xs text-gray-600 uppercase tracking-wider">Heartbeat Freshness</p>
          <p className="text-3xl font-bold mt-1">{status.heartbeatFreshness}</p>
          <p className="text-xs text-gray-500 mt-2">Validators must ping within this window</p>
        </div>
      </div>

      {/* Active Validators List */}
      {status.validators.length > 0 && (
        <div className="border rounded-lg p-4">
          <h3 className="font-bold mb-3 flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-green-600" />
            Active External Validators
          </h3>
          <div className="space-y-2">
            {status.validators.map((v, i) => (
              <div key={v.telegramId} className="flex justify-between text-sm p-2 bg-gray-50 rounded">
                <span className="font-mono">#{i + 1} {v.telegramId}</span>
                <span className="text-gray-600">Score: {v.score.toFixed(4)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Mode Explanation */}
      <div className="border rounded-lg p-4 bg-gray-50">
        <h3 className="font-bold mb-2 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          Understanding Consensus Modes
        </h3>
        <div className="text-sm space-y-2 text-gray-700">
          <p>
            <span className="font-semibold">Internal Mode:</span> Vercel self-produces all blocks. No external validator nodes are actively participating yet.
          </p>
          <p>
            <span className="font-semibold">Leader-Proposal Mode:</span> ≥1 external validator node is online and sending heartbeats. Vercel deterministically elects one as leader for each block; they have a window to counter-sign (future). Currently Vercel still seals blocks and credits elected leaders.
          </p>
        </div>
      </div>
    </div>
  );
}
