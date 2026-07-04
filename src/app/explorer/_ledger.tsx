"use client"

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Hash, ShieldCheck, Lock, MessageSquare, Database, Archive, PieChart, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { MAX_SUPPLY, MINING_REWARDS_CAP } from '@/lib/blockchain';
import { getChainState, getRecentBlocks } from '@/actions/mining-actions';
import { BlockDetailSheet } from '@/components/BlockDetailSheet';

export default function LedgerContent() {
  const [chainState, setChainState] = useState<any>(null);
  const [blocks, setBlocks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBlock, setSelectedBlock] = useState<number | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const [state, recentBlocks] = await Promise.all([getChainState(), getRecentBlocks(10)]);
        setChainState(state);
        setBlocks(recentBlocks);
      } catch {}
      finally { setLoading(false); }
    }
    fetchData();
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, []);

  const isHalted = chainState?.status === 'halted';
  const isRecovering = chainState?.status === 'recovering';
  const totalMinted = chainState?.totalMinted || 0;
  const miningMinted = chainState?.buckets?.mining?.minted || 0;

  return (
    <div className="px-2 py-4 space-y-4 pb-24">
      <div className="flex items-center justify-between">
        <h2 className="font-headline text-[10px] font-black uppercase text-muted-foreground">Block Explorer</h2>
        {loading ? <Badge variant="outline" className="animate-pulse text-[9px]">Syncing...</Badge>
          : isHalted ? <Badge variant="destructive" className="animate-pulse text-[9px]"><Lock className="w-3 h-3 mr-1" />HALTED</Badge>
          : isRecovering ? <Badge variant="outline" className="text-yellow-500 border-yellow-500/50 text-[9px]"><MessageSquare className="w-3 h-3 mr-1" />RECOVERY</Badge>
          : <Badge variant="secondary" className="bg-green-500/10 text-green-500 border-green-500/20 text-[9px]"><ShieldCheck className="w-3 h-3 mr-1" />STABLE</Badge>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card className="bg-card/40 border-border/30">
          <CardContent className="p-3">
            <div className="flex items-center space-x-2 mb-1">
              <Database className="w-3 h-3 text-primary" />
              <p className="text-[10px] text-muted-foreground uppercase font-bold">Blocks</p>
            </div>
            <p className="font-code text-lg font-bold">#{chainState?.blockCount ?? '0'}</p>
          </CardContent>
        </Card>
        <Card className="bg-card/40 border-border/30">
          <CardContent className="p-3">
            <div className="flex items-center space-x-2 mb-1">
              <PieChart className="w-3 h-3 text-primary" />
              <p className="text-[10px] text-muted-foreground uppercase font-bold">Minted</p>
            </div>
            <p className="font-code text-lg font-bold">{(totalMinted / MAX_SUPPLY * 100).toFixed(4)}%</p>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card/40 border-border/30">
        <CardContent className="px-2 py-4 space-y-3">
          <div className="space-y-2">
            <div className="flex justify-between text-[10px] font-bold uppercase">
              <span className="text-muted-foreground">Total Supply</span>
              <span className="text-primary">{totalMinted.toLocaleString()} / 1B EAST</span>
            </div>
            <Progress value={(totalMinted / MAX_SUPPLY) * 100} className="h-1.5" />
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-[10px] font-bold uppercase">
              <span className="text-muted-foreground">Mining Pool</span>
              <span className="text-primary">{miningMinted.toLocaleString()} / 650M</span>
            </div>
            <Progress value={(miningMinted / MINING_REWARDS_CAP) * 100} className="h-1.5" />
          </div>
        </CardContent>
      </Card>

      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="p-4">
          <p className="text-[10px] text-muted-foreground uppercase font-black mb-2">L2 Verified Head</p>
          <p className="font-code text-[10px] break-all text-primary/80 font-bold">
            {chainState?.lastBlockHash || 'GENESIS_WAITING'}
          </p>
        </CardContent>
      </Card>

      <p className="text-[9px] text-white/30 uppercase font-black px-1">
        Recent Blocks — tap to inspect
      </p>

      <ScrollArea className="h-[280px] rounded-xl">
        <div className="space-y-3">
  {blocks.map((block: any) => (
    <Card
      key={block.block_hash}
      className="bg-card/20 border-border/20 cursor-pointer hover:bg-card/40 hover:border-primary/30 transition-all active:scale-[0.98]"
      onClick={() => setSelectedBlock(block.block_index)}
    >
      <CardContent className="px-2 py-4 space-y-2">
        <div className="flex justify-between items-start">
          <div className="flex items-center space-x-2">
            <div className="bg-primary/20 text-primary p-1.5 rounded-lg">
              <Hash className="w-3 h-3" />
            </div>
            <div>
              <p className="text-xs font-bold font-code">Block #{block.block_index}</p>
              <p className="text-[9px] text-muted-foreground">{new Date(block.created_at).toLocaleTimeString()}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20 text-[8px] uppercase font-black">
              {block.tx_type || 'BLOCK'}
            </Badge>
            <ChevronRight className="w-3 h-3 text-white/20" />
          </div>
        </div>
        <div className="bg-background/40 rounded p-2 border border-border/30">
          <p className="text-[8px] text-muted-foreground uppercase font-bold">Miner</p>
          <p className="font-code text-[9px] text-primary/70 truncate">{block.miner_address}</p>
        </div>
        <div className="bg-background/40 rounded p-2 border border-border/30">
          <p className="text-[8px] text-muted-foreground uppercase font-bold">Validated By</p>
          <p className="font-code text-[9px] text-primary/70 truncate">
            {block.validator_id ? `Validator #${block.validator_id}` : 'No active validator'}
          </p>
        </div>
        <div className="flex justify-between text-[9px] font-bold uppercase">
          <span className="text-muted-foreground">Reward: <span className="text-primary">{block.reward} EAST</span></span>
          <div className="flex items-center text-green-500"><ShieldCheck className="w-3 h-3 mr-1" />VERIFIED</div>
        </div>
      </CardContent>
    </Card>
  ))}
  {chainState?.lastPrunedIndex >= 0 && (
    <div className="py-4 border-t border-dashed border-border/50 flex flex-col items-center space-y-2">
      <Archive className="w-4 h-4 text-muted-foreground opacity-50" />
      <p className="text-[9px] text-muted-foreground uppercase font-bold text-center">
        Blocks before #{chainState.lastPrunedIndex + 1} archived to Cold Storage
      </p>
    </div>
  )}
</div>

      {/* Block Detail Sheet */}
      <BlockDetailSheet
        blockIndex={selectedBlock}
        onClose={() => setSelectedBlock(null)}
      />
    </div>
  );
}
