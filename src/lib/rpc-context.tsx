"use client"

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';

type RPCNode = {
  id: string;
  name: string;
  url: string;
  chain: 'Ethereum' | 'Solana' | 'Base' | 'BSC';
  latency: number | null;
  status: 'online' | 'offline' | 'checking';
};

type RPCContextType = {
  isAutoMode: boolean;
  setIsAutoMode: (val: boolean) => void;
  currentRPC: RPCNode | null;
  nodes: RPCNode[];
  refreshLatencies: () => Promise<void>;
  setCurrentRPC: (node: RPCNode) => void;
  selectedChain: 'Ethereum' | 'Solana' | 'Base' | 'BSC';
  setSelectedChain: (chain: 'Ethereum' | 'Solana' | 'Base' | 'BSC') => void;
  isFindingRPC: boolean;
};

const INITIAL_NODES: RPCNode[] = [
  // Ethereum
  { id: 'eth-1', name: 'Ankr ETH',    url: 'https://rpc.ankr.com/eth',              chain: 'Ethereum', latency: null, status: 'offline' },
  { id: 'eth-2', name: 'Flashbots',   url: 'https://rpc.flashbots.net',              chain: 'Ethereum', latency: null, status: 'offline' },
  { id: 'eth-3', name: 'Llama ETH',   url: 'https://eth.llamarpc.com',               chain: 'Ethereum', latency: null, status: 'offline' },
  // Solana
  { id: 'sol-1', name: 'SOL Mainnet', url: 'https://api.mainnet-beta.solana.com',    chain: 'Solana',   latency: null, status: 'offline' },
  { id: 'sol-2', name: 'Ankr SOL',    url: 'https://rpc.ankr.com/solana',            chain: 'Solana',   latency: null, status: 'offline' },
  { id: 'sol-3', name: 'Helius SOL',  url: 'https://mainnet.helius-rpc.com/?api-key=public', chain: 'Solana', latency: null, status: 'offline' },
  // Base
  { id: 'base-1', name: 'Base Official', url: 'https://mainnet.base.org',            chain: 'Base',     latency: null, status: 'offline' },
  { id: 'base-2', name: 'Llama Base',    url: 'https://base.llamarpc.com',           chain: 'Base',     latency: null, status: 'offline' },
  { id: 'base-3', name: 'Ankr Base',     url: 'https://rpc.ankr.com/base',           chain: 'Base',     latency: null, status: 'offline' },
  // BSC
  { id: 'bsc-1', name: 'BSC Official',  url: 'https://bsc-dataseed.binance.org',     chain: 'BSC',      latency: null, status: 'offline' },
  { id: 'bsc-2', name: 'Ankr BSC',      url: 'https://rpc.ankr.com/bsc',             chain: 'BSC',      latency: null, status: 'offline' },
  { id: 'bsc-3', name: 'Llama BSC',     url: 'https://binance.llamarpc.com',         chain: 'BSC',      latency: null, status: 'offline' },
];

const RPCContext = createContext<RPCContextType | undefined>(undefined);

export function RPCProvider({ children }: { children: React.ReactNode }) {
  const [isAutoMode, setIsAutoMode] = useState(true);
  const [selectedChain, setSelectedChain] = useState<'Ethereum' | 'Solana' | 'Base' | 'BSC'>('Ethereum');
  const [nodes, setNodes] = useState<RPCNode[]>(INITIAL_NODES);
  const [currentRPC, setCurrentRPCState] = useState<RPCNode | null>(null);
  const [isFindingRPC, setIsFindingRPC] = useState(false);
  const nodesRef = useRef<RPCNode[]>(nodes);

  useEffect(() => { nodesRef.current = nodes; }, [nodes]);

  const pingNode = async (node: RPCNode): Promise<{ latency: number | null; status: 'online' | 'offline' }> => {
    const start = Date.now();
    try {
      // Solana pakai JSON-RPC getHealth, bukan eth_blockNumber
      const isSolana = node.chain === 'Solana';
      const body = isSolana
        ? JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' })
        : JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 });

      const response = await fetch(node.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(5000), // 5s timeout
      });

      if (response.ok || response.status === 405 || response.status === 400) {
        return { latency: Date.now() - start, status: 'online' };
      }
      return { latency: null, status: 'offline' };
    } catch {
      // Timeout or network error = truly offline
      return { latency: null, status: 'offline' };
    }
  };

  // AI RPC Fallback — call the Claude API to find an active node
  const findRPCWithAI = useCallback(async (chain: string) => {
    setIsFindingRPC(true);
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1000,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
          messages: [{
            role: 'user',
            content: `Find 3 currently active and free public RPC endpoints for ${chain} blockchain in 2025. Search for the latest working RPC URLs. Return ONLY a JSON array like: [{"name":"Node Name","url":"https://..."}]. No explanation, just the JSON array.`
          }]
        })
      });

      const data = await response.json();
      const text = data.content
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('');

      // Parse JSON from the response
      const match = text.match(/\[[\s\S]*?\]/);
      if (!match) return;

      const found: { name: string; url: string }[] = JSON.parse(match[0]);
      const newNodes: RPCNode[] = found.map((n, i) => ({
        id: `ai-${chain.toLowerCase()}-${i}`,
        name: `[AI] ${n.name}`,
        url: n.url,
        chain: chain as RPCNode['chain'],
        latency: null,
        status: 'offline' as const,
      }));

      // Add to the nodes list
      setNodes(prev => {
        const filtered = prev.filter(n => !n.id.startsWith(`ai-${chain.toLowerCase()}`));
        return [...filtered, ...newNodes];
      });

      // Ping the new nodes and auto-connect to whichever is online
      for (const node of newNodes) {
        const result = await pingNode(node);
        if (result.status === 'online') {
          setNodes(prev => prev.map(n => n.id === node.id ? { ...n, ...result } : n));
          if (isAutoMode) {
            setCurrentRPCState({ ...node, ...result });
            break;
          }
        }
      }
    } catch (err) {
      console.error('AI RPC fallback failed', err);
    } finally {
      setIsFindingRPC(false);
    }
  }, [isAutoMode]);

  const refreshLatencies = useCallback(async () => {
    setNodes(prev => prev.map(n => n.chain === selectedChain ? { ...n, status: 'checking' } : n));

    const currentNodes = nodesRef.current;
    const updatedNodes = await Promise.all(
      currentNodes.map(async (node) => {
        if (node.chain !== selectedChain) return node;
        const result = await pingNode(node);
        return { ...node, ...result };
      })
    );

    setNodes(updatedNodes);

    if (isAutoMode) {
      const best = [...updatedNodes]
        .filter(n => n.chain === selectedChain && n.status === 'online')
        .sort((a, b) => (a.latency || 999) - (b.latency || 999))[0];

      if (best) {
        setCurrentRPCState(best);
      } else {
        // Semua node offline — minta AI carikan node baru
        findRPCWithAI(selectedChain);
      }
    }
  }, [selectedChain, isAutoMode, findRPCWithAI]);

  useEffect(() => {
    refreshLatencies();
    const interval = setInterval(() => {
      if (isAutoMode) refreshLatencies();
    }, 30000);
    return () => clearInterval(interval);
  }, [selectedChain, isAutoMode, refreshLatencies]);

  const setCurrentRPC = (node: RPCNode) => {
    setIsAutoMode(false);
    setSelectedChain(node.chain);
    setCurrentRPCState(node);
  };

  return (
    <RPCContext.Provider value={{
      isAutoMode, setIsAutoMode,
      currentRPC,
      nodes: nodes.filter(n => n.chain === selectedChain),
      refreshLatencies,
      setCurrentRPC,
      selectedChain, setSelectedChain,
      isFindingRPC,
    }}>
      {children}
    </RPCContext.Provider>
  );
}

export function useRPC() {
  const context = useContext(RPCContext);
  if (!context) throw new Error('useRPC must be used within RPCProvider');
  return context;
}
