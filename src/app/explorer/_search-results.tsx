"use client"

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Hash, ArrowRight, ShieldCheck, X, Database, User } from 'lucide-react';

interface SearchResultsProps {
  results: any;
  onClear: () => void;
}

function TxRow({ tx }: { tx: any }) {
  return (
    <div className="py-2.5 border-b border-white/5 last:border-0">
      <div className="flex justify-between items-start mb-1">
        <div className="flex items-center gap-2">
          <Badge className="text-[8px] bg-primary/10 text-primary border-primary/20 uppercase font-black px-1.5 py-0">
            {tx.tx_type}
          </Badge>
          <span className="text-[9px] text-white/30">{new Date(tx.created_at).toLocaleTimeString()}</span>
        </div>
        <div className="flex items-center gap-1 text-green-500">
          <ShieldCheck className="w-3 h-3" />
          <span className="text-[8px] font-bold uppercase">Confirmed</span>
        </div>
      </div>
      <div className="flex items-center gap-2 text-[10px] text-white/50">
        <span className="font-mono truncate max-w-[80px]">{tx.sender_address?.substring(0, 8)}...</span>
        <ArrowRight className="w-3 h-3 shrink-0" />
        <span className="font-mono truncate max-w-[80px]">{tx.recipient_address?.substring(0, 8)}...</span>
      </div>
      <div className="flex justify-between mt-1">
        <span className="font-mono text-[9px] text-white/20 truncate">{tx.tx_hash?.substring(0, 18)}...</span>
        <span className="text-[10px] font-bold text-white">{tx.amount} EAST</span>
      </div>
    </div>
  );
}

export function SearchResults({ results, onClear }: SearchResultsProps) {
  if (results.type === 'not_found') {
    return (
      <Card className="bg-white/[0.03] border-white/5 rounded-2xl">
        <CardContent className="p-5 text-center space-y-2">
          <p className="text-white/40 text-sm font-bold">No results found</p>
          <p className="text-white/20 text-[10px]">"{results.query}"</p>
          <Button onClick={onClear} variant="ghost" className="text-primary text-[10px] h-8">Clear Search</Button>
        </CardContent>
      </Card>
    );
  }

  if (results.type === 'error') {
    return (
      <Card className="bg-red-500/5 border-red-500/20 rounded-2xl">
        <CardContent className="p-4 text-center">
          <p className="text-red-400 text-sm font-bold">Search failed</p>
          <Button onClick={onClear} variant="ghost" className="text-white/40 text-[10px] h-8 mt-2">Clear</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-white/40 text-[10px] uppercase font-black">
          {results.type === 'block' ? 'Block Found' :
           results.type === 'transaction' ? 'Transaction Found' :
           results.type === 'address' || results.type === 'eastid' ? 'Address Found' : 'Result'}
        </p>
        <Button onClick={onClear} variant="ghost" size="icon" className="h-6 w-6 text-white/30">
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Block result */}
      {(results.type === 'block') && results.block && (
        <Card className="bg-white/[0.03] border-white/5 rounded-2xl">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-primary" />
                <span className="text-white font-bold">Block #{results.block.block_index}</span>
              </div>
              <Badge className="bg-primary/10 text-primary border-primary/20 text-[9px] font-black">
                {results.block.is_empty ? 'EMPTY' : `${results.transactions?.length || 0} TXS`}
              </Badge>
            </div>
            <div className="bg-white/[0.03] rounded-xl p-3 space-y-2">
              <InfoRow label="Block Hash" value={`${results.block.block_hash?.substring(0, 20)}...`} mono />
              <InfoRow label="Prev Hash" value={`${results.block.prev_hash?.substring(0, 20)}...`} mono />
              <InfoRow label="VSH" value={`${results.block.sequence_hash?.substring(0, 20)}...`} mono />
              <InfoRow label="Time" value={new Date(results.block.created_at).toLocaleString()} />
            </div>
            {results.transactions?.length > 0 && (
              <div>
                <p className="text-white/30 text-[9px] uppercase font-black mb-2">Transactions</p>
                <div className="bg-white/[0.02] rounded-xl px-3">
                  {results.transactions.map((tx: any) => <TxRow key={tx.tx_hash} tx={tx} />)}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Transaction result */}
      {results.type === 'transaction' && results.transaction && (
        <Card className="bg-white/[0.03] border-white/5 rounded-2xl">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Hash className="w-4 h-4 text-primary" />
              <span className="text-white font-bold">Transaction</span>
              <Badge className="bg-primary/10 text-primary border-primary/20 text-[9px] font-black">{results.transaction.tx_type}</Badge>
            </div>
            <div className="bg-white/[0.03] rounded-xl p-3 space-y-2">
              <InfoRow label="TX Hash" value={`${results.transaction.tx_hash?.substring(0, 20)}...`} mono />
              <InfoRow label="Block" value={`#${results.transaction.block_index}`} />
              <InfoRow label="From" value={`${results.transaction.sender_address?.substring(0, 12)}...`} mono />
              <InfoRow label="To" value={`${results.transaction.recipient_address?.substring(0, 12)}...`} mono />
              <InfoRow label="Amount" value={`${results.transaction.amount} EAST`} highlight />
              <InfoRow label="Gas" value={results.transaction.gas_fee > 0 ? `${results.transaction.gas_fee} EAST` : 'Free'} />
              <InfoRow label="Status" value={results.transaction.status?.toUpperCase()} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Address / EAST ID result */}
      {(results.type === 'address' || results.type === 'eastid') && (
        <Card className="bg-white/[0.03] border-white/5 rounded-2xl">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <User className="w-4 h-4 text-primary" />
              <span className="text-white font-bold">Address</span>
            </div>
            {results.user && (
              <div className="bg-white/[0.03] rounded-xl p-3 space-y-2">
                <InfoRow label="Username" value={`@${results.user.username || 'unknown'}`} />
                <InfoRow label="Address" value={`${results.address?.substring(0, 16)}...`} mono />
                <InfoRow label="Balance" value={`${Number(results.user.balance || 0).toLocaleString()} EAST`} highlight />
              </div>
            )}
            {results.transactions?.length > 0 && (
              <div>
                <p className="text-white/30 text-[9px] uppercase font-black mb-2">Recent Transactions ({results.transactions.length})</p>
                <div className="bg-white/[0.02] rounded-xl px-3">
                  {results.transactions.slice(0, 10).map((tx: any) => <TxRow key={tx.tx_hash} tx={tx} />)}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function InfoRow({ label, value, mono, highlight }: { label: string; value: string; mono?: boolean; highlight?: boolean }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-white/30 text-[9px] uppercase font-bold">{label}</span>
      <span className={`text-[10px] font-bold ${mono ? 'font-mono' : ''} ${highlight ? 'text-primary' : 'text-white/70'}`}>{value}</span>
    </div>
  );
}
