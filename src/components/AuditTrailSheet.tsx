"use client"

import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Archive, Loader2, ShieldAlert } from 'lucide-react';
import { getAuditTrail } from '@/actions/mining-actions';

interface AuditTrailSheetProps {
  telegramId: string;
  initData: string;
  isFounder: boolean;
}

interface Bucket {
  bucket: string;
  cap: number;
  minted: number;
  updated_at: string;
}

interface MintLogEntry {
  bucket: string;
  amount: number;
  reason: string;
  triggered_by: string;
  created_at: string;
}

export function AuditTrailSheet({ telegramId, initData, isFounder }: AuditTrailSheetProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [mintLog, setMintLog] = useState<MintLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Hide entirely for non-founders
  if (!isFounder) return null;

  const handleOpen = async (v: boolean) => {
    setOpen(v);
    if (v) {
      setLoading(true);
      setError(null);
      const result = await getAuditTrail(telegramId, initData);
      if (result.success) {
        setBuckets(result.buckets || []);
        setMintLog(result.mintLog || []);
      } else {
        setError(result.error || 'Unknown error');
      }
      setLoading(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={handleOpen}>
      <SheetTrigger asChild>
        <Button variant="outline"
          className="h-12 rounded-2xl border-white/5 bg-white/5 hover:bg-white/10 text-white/40 text-[10px] font-black uppercase">
          <Archive className="w-4 h-4 mr-2 opacity-50" />Audit Chain
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="h-[85vh] bg-background border-t border-primary/20 rounded-t-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-headline uppercase flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-primary" />
            Founder Audit Trail
          </SheetTitle>
        </SheetHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : error ? (
          <div className="p-4 text-center text-red-400 text-sm">{error}</div>
        ) : (
          <div className="p-3 space-y-4">
            {/* Supply Buckets */}
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-white/40 mb-2 px-1">
                Supply Buckets
              </p>
              <div className="space-y-2">
                {buckets.map((b) => (
                  <div key={b.bucket} className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-3">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-bold uppercase text-white">{b.bucket}</span>
                      <span className="text-[10px] text-white/40">
                        {Number(b.minted).toLocaleString()} / {Number(b.cap).toLocaleString()}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/10 mt-2 overflow-hidden">
                      <div className="h-full bg-primary rounded-full"
                        style={{ width: `${Math.min(100, (Number(b.minted) / Number(b.cap)) * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Mint Log */}
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-white/40 mb-2 px-1">
                Mint Log (Last 100)
              </p>
              <div className="space-y-1.5">
                {mintLog.length === 0 && (
                  <p className="text-center text-white/30 text-xs py-6">No mint activity recorded.</p>
                )}
                {mintLog.map((entry, i) => (
                  <div key={i} className="bg-white/[0.03] border border-white/[0.06] rounded-lg p-2.5 flex justify-between items-center">
                    <div>
                      <p className="text-[11px] font-bold text-white">
                        +{Number(entry.amount).toLocaleString()} <span className="text-primary">{entry.bucket}</span>
                      </p>
                      <p className="text-[9px] text-white/30">
                        {entry.reason} · by {entry.triggered_by}
                      </p>
                    </div>
                    <span className="text-[9px] text-white/20">
                      {new Date(entry.created_at).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
