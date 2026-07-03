"use client"

import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Hash, ArrowRight, Loader2, ShieldCheck, Zap, Send, Users, Database } from 'lucide-react';
import { getBlockDetail } from '@/actions/mining-actions';

interface BlockDetailSheetProps {
  blockIndex: number | null;
  onClose: () => void;
}

const TX_TYPE_COLORS: Record<string, string> = {
  MINING: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  TRANSFER: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  STAKE: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  REFERRAL: 'bg-green-500/10 text-green-400 border-green-500/20',
  EMPTY: 'bg-white/5 text-white/30 border-white/10',
};

const TX_TYPE_ICONS: Record<string, any> = {
  MINING: Zap,
  TRANSFER: Send,
  STAKE: Users,
  REFERRAL: Users,
  EMPTY: Database,
};

function truncate(str: string, start = 8, end = 6) {
  if (!str || str.length <= start + end) return str;
  return `${str.slice(0, start)}...${str.slice(-end)}`;
}

export function BlockDetailSheet({ blockIndex, onClose }: BlockDetailSheetProps) {
  const [block, setBlock] = useState<any>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prevIndex, setPrevIndex] = useState<number | null>(null);

  const open = blockIndex !== null;

  // Fetch when blockIndex changes
  if (blockIndex !== null && blockIndex !== prevIndex) {
    setPrevIndex(blockIndex);
    setLoading(true);
    setError(null);
    setBlock(null);
    setTransactions([]);
    getBlockDetail(blockIndex).then(res => {
      if (res.success) {
        setBlock(res.block);
        setTransactions(res.transactions || []);
      } else {
        setError(res.error || 'Failed to load block');
      }
      setLoading(false);
    });
  }

  return (
    <Sheet open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <SheetContent
        side="bottom"
        className="h-[88vh] bg-background border-t border-primary/20 rounded-t-2xl overflow-y-auto p-0"
      >
        <SheetHeader className="px-4 pt-5 pb-3 border-b border-white/5">
          <SheetTitle className="font-headline uppercase text-sm flex items-center gap-2">
            <Hash className="w-4 h-4 text-primary" />
            Block #{blockIndex}
          </SheetTitle>
        </SheetHeader>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : error ? (
          <div className="p-4 text-center text-red-400 text-sm">{error}</div>
        ) : block ? (
          <div className="p-4 space-y-4">
            {/* Block Info */}
            <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase font-black text-white/40">Status</span>
                <div className="flex items-center gap-1 text-green-500 text-[10px] font-black uppercase">
                  <ShieldCheck className="w-3 h-3" />Verified
                </div>
              </div>
              <div>
                <p className="text-[9px] uppercase font-black text-white/30 mb-1">Block Hash</p>
                <p className="font-mono text-[10px] text-primary/80 break-all">{block.block_hash}</p>
              </div>
              <div>
                <p className="text-[9px] uppercase font-black text-white/30 mb-1">Prev Hash</p>
                <p className="font-mono text-[10px] text-white/40 break-all">{block.prev_hash}</p>
              </div>
              <div>
                <p className="text-[9px] uppercase font-black text-white/30 mb-1">Sequence Hash</p>
                <p className="font-mono text-[10px] text-white/40 break-all">{block.sequence_hash}</p>
              </div>
              <div>
                <p className="text-[9px] uppercase font-black text-white/30 mb-1">Merkle Root</p>
                <p className="font-mono text-[10px] text-white/40 break-all">{block.merkle_root || '—'}</p>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[9px] uppercase font-black text-white/30">Validated By</span>
                <span className="font-mono text-[10px] text-primary/80">
                  {block.validator_id ? `Validator #${block.validator_id}` : 'No active validator'}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 pt-1">
                <div className="bg-white/5 rounded-xl p-2 text-center">
                  <p className="text-[9px] text-white/30 uppercase font-black">Txs</p>
                  <p className="text-sm font-bold text-white">{block.tx_count}</p>
                </div>
                <div className="bg-white/5 rounded-xl p-2 text-center">
                  <p className="text-[9px] text-white/30 uppercase font-black">Gas</p>
                  <p className="text-sm font-bold text-white">{block.total_gas ?? 0}</p>
                </div>
                <div className="bg-white/5 rounded-xl p-2 text-center">
                  <p className="text-[9px] text-white/30 uppercase font-black">Time</p>
                  <p className="text-[10px] font-bold text-white">
                    {new Date(block.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            </div>

            {/* Transactions */}
            <div>
              <p className="text-[10px] uppercase font-black text-white/40 mb-2">
                Transactions ({transactions.length})
              </p>

              {transactions.length === 0 ? (
                <div className="bg-white/[0.02] border border-white/5 rounded-xl p-6 text-center">
                  <Database className="w-6 h-6 text-white/20 mx-auto mb-2" />
                  <p className="text-[10px] text-white/30 uppercase font-black">Empty Block</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {transactions.map((tx, i) => {
                    const Icon = TX_TYPE_ICONS[tx.tx_type] || Hash;
                    const colorClass = TX_TYPE_COLORS[tx.tx_type] || TX_TYPE_COLORS.EMPTY;
                    return (
                      <div key={i} className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-3 space-y-2">
                        {/* TX header */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className={`p-1.5 rounded-lg border ${colorClass}`}>
                              <Icon className="w-3 h-3" />
                            </div>
                            <div>
                              <Badge className={`text-[8px] font-black uppercase border ${colorClass}`}>
                                {tx.tx_type}
                              </Badge>
                            </div>
                          </div>
                          <span className="text-[10px] font-bold text-primary">
                            {tx.amount > 0 ? `+${Number(tx.amount).toLocaleString()} EAST` : '—'}
                          </span>
                        </div>

                        {/* TX Hash */}
                        <div>
                          <p className="text-[8px] text-white/30 uppercase font-black mb-0.5">TX Hash</p>
                          <p className="font-mono text-[9px] text-white/60 break-all">{tx.tx_hash}</p>
                        </div>

                        {/* From → To */}
                        {tx.sender_address && (
                          <div className="flex items-center gap-2 bg-white/5 rounded-lg p-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-[8px] text-white/30 uppercase font-black">From</p>
                              <p className="font-mono text-[9px] text-white/60 truncate">{truncate(tx.sender_address)}</p>
                            </div>
                            <ArrowRight className="w-3 h-3 text-white/20 shrink-0" />
                            <div className="flex-1 min-w-0 text-right">
                              <p className="text-[8px] text-white/30 uppercase font-black">To</p>
                              <p className="font-mono text-[9px] text-white/60 truncate">{truncate(tx.recipient_address || '—')}</p>
                            </div>
                          </div>
                        )}

                        {/* Status + Time */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1 text-green-500 text-[9px] font-black uppercase">
                            <ShieldCheck className="w-3 h-3" />{tx.status}
                          </div>
                          <span className="text-[9px] text-white/30">
                            {new Date(tx.created_at).toLocaleString('id-ID', {
                              day: '2-digit', month: 'short',
                              hour: '2-digit', minute: '2-digit'
                            })}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
