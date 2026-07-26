"use client"

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, X } from 'lucide-react';
import LedgerContent from './_ledger';
import VestingContent from './_vesting';
import { SearchResults } from './_search-results';
import { searchExplorer } from '@/actions/mining-actions';

export default function ExplorerPage() {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<any>(null);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await searchExplorer(query.trim());
      setResults(res);
    } catch (err) {
      setResults({ type: 'error' });
    } finally {
      setSearching(false);
    }
  };

  const handleClear = () => {
    setQuery('');
    setResults(null);
  };

  return (
    <div className="flex flex-col pb-8">
      {/* Search Bar */}
      <div className="px-3 pt-4 pb-3 space-y-2">
        <p className="text-white/40 text-[10px] uppercase font-black tracking-widest">Block Explorer</p>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
            <Input
              placeholder="0x hash · address · EAST-ID · #block"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              className="pl-9 pr-8 h-11 bg-white/[0.04] border-white/10 text-white placeholder:text-white/20 rounded-xl font-mono text-[11px]"
            />
            {query && (
              <button onClick={handleClear} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <Button
            onClick={handleSearch}
            disabled={!query.trim() || searching}
            className="h-11 px-4 rounded-xl bg-primary/20 hover:bg-primary/30 text-primary border border-primary/20 font-black uppercase text-[10px]"
          >
            {searching ? '...' : 'Find'}
          </Button>
        </div>
        <p className="text-white/20 text-[9px]">
          Search by: block hash · tx hash · wallet address (0x...) · EAST ID · block number (#142)
        </p>
      </div>

      {/* Search Results */}
      {results && (
        <div className="px-3 mb-4">
          <SearchResults results={results} onClear={handleClear} />
        </div>
      )}

      {/* Tabs */}
      {!results && (
        <Tabs defaultValue="ledger" className="flex flex-col flex-1">
          <div className="px-3 pb-3">
            <TabsList className="w-full grid grid-cols-2 bg-white/[0.04] rounded-xl p-1 h-11">
              <TabsTrigger value="ledger" className="text-[10px] font-black uppercase tracking-wider rounded-lg data-[state=active]:bg-primary data-[state=active]:text-white">
                Ledger
              </TabsTrigger>
              <TabsTrigger value="vesting" className="text-[10px] font-black uppercase tracking-wider rounded-lg data-[state=active]:bg-primary data-[state=active]:text-white">
                Vesting
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="ledger" className="outline-none mt-0"><LedgerContent /></TabsContent>
          <TabsContent value="vesting" className="outline-none mt-0"><VestingContent /></TabsContent>
        </Tabs>
      )}
    </div>
  );
}
