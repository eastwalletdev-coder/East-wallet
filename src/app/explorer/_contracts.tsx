"use client"

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FileCode2, Copy, Check, Activity } from 'lucide-react';
import { CONTRACTS, CONTRACT_ABI, EAST_CHAIN_ID } from '@/lib/contracts/registry';
import { getContractCallStats } from '@/actions/mining-actions';

// Human-readable context per contract — the ABI below is accurate but
// terse (just param names); this is what actually explains WHAT each one
// does to someone browsing the explorer without reading the source.
const CONTRACT_INFO: Record<string, { name: string; description: string }> = {
  [CONTRACTS.STAKING]: {
    name: 'Staking',
    description: 'Lock EAST to raise your mining tier. Stake is currently locked-only — slashing is not implemented yet (see docs).',
  },
  [CONTRACTS.VESTING]: {
    name: 'Vesting',
    description: 'Founder allocation release schedule — 12-month cliff, then monthly for 36 more months.',
  },
  [CONTRACTS.MINING]: {
    name: 'Mining',
    description: 'Epoch-based mining rewards and Light Node participation bonus claims.',
  },
  [CONTRACTS.VALIDATOR]: {
    name: 'Validator',
    description: 'Recovery-round governance voting — approve/reject to help restore the network after a halt.',
  },
};

type Stats = Record<string, { totalCalls: number; successCalls: number; lastCallAt: string | null }>;

function truncate(addr: string) {
  return `${addr.slice(0, 10)}...${addr.slice(-6)}`;
}

export default function ContractsContent() {
  const [stats, setStats] = useState<Stats>({});
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    async function fetchStats() {
      try {
        setStats(await getContractCallStats());
      } catch {}
      finally { setLoading(false); }
    }
    fetchStats();
    const interval = setInterval(fetchStats, 30_000);
    return () => clearInterval(interval);
  }, []);

  const copyAddress = (addr: string) => {
    navigator.clipboard?.writeText(addr);
    setCopied(addr);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="px-3 space-y-3">
      <div className="flex items-center justify-between px-1">
        <p className="text-[9px] text-white/30 uppercase font-black flex items-center gap-1">
          <FileCode2 className="w-3 h-3" /> Deployed Contracts
        </p>
        <span className="text-[9px] text-white/20 font-mono">chainId {EAST_CHAIN_ID}</span>
      </div>

      {Object.values(CONTRACTS).map((address) => {
        const info = CONTRACT_INFO[address];
        const abi = CONTRACT_ABI[address] || {};
        const stat = stats[address];
        return (
          <Card key={address} className="bg-card/20 border-border/20">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-white text-sm font-black">{info?.name ?? 'Unknown'}</p>
                  <p className="text-white/40 text-[10px] leading-relaxed mt-0.5">{info?.description}</p>
                </div>
                {!loading && (
                  <Badge className="bg-white/5 text-white/40 border-white/10 text-[8px] font-black uppercase shrink-0 ml-2">
                    <Activity className="w-2.5 h-2.5 mr-1" />
                    {stat?.totalCalls ?? 0} calls
                  </Badge>
                )}
              </div>

              <button
                onClick={() => copyAddress(address)}
                className="w-full flex items-center justify-between bg-white/[0.03] rounded-lg px-2.5 py-2 hover:bg-white/[0.06] transition-colors"
              >
                <span className="font-mono text-[10px] text-primary/70">{truncate(address)}</span>
                {copied === address
                  ? <Check className="w-3 h-3 text-green-400" />
                  : <Copy className="w-3 h-3 text-white/20" />}
              </button>

              <div>
                <p className="text-[8px] text-white/30 uppercase font-black mb-1.5">Callable Functions</p>
                <div className="space-y-1">
                  {Object.entries(abi).map(([fnName, params]) => (
                    <div key={fnName} className="flex items-center gap-1.5 font-mono text-[10px]">
                      <span className="text-white/80">{fnName}</span>
                      <span className="text-white/30">
                        ({params.join(', ') || ''})
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}