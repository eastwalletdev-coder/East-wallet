"use client";

import { useEffect, useState } from "react";

export function TradeHistory() {
  const [trades, setTrades] = useState<any[]>([]);

  useEffect(() => {
    const initialTrades = Array.from({ length: 25 }, (_, i) => ({
      id: i,
      price: 41200 + (Math.random() - 0.5) * 20,
      amount: (Math.random() * 0.5).toFixed(4),
      time: new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      side: Math.random() > 0.5 ? 'buy' : 'sell'
    }));
    setTrades(initialTrades);

    const interval = setInterval(() => {
      const newTrade = {
        id: Date.now(),
        price: 41200 + (Math.random() - 0.5) * 20,
        amount: (Math.random() * 0.5).toFixed(4),
        time: new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        side: Math.random() > 0.5 ? 'buy' : 'sell'
      };
      setTrades(prev => [newTrade, ...prev].slice(0, 30));
    }, 1500);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex-1 overflow-auto">
      <div className="grid grid-cols-3 px-4 py-2 text-[10px] font-semibold text-muted-foreground border-b border-border uppercase">
        <span>Price</span>
        <span className="text-right">Amount</span>
        <span className="text-right">Time</span>
      </div>
      <div className="font-data text-[11px]">
        {trades.map((trade) => (
          <div key={trade.id} className="grid grid-cols-3 px-4 py-0.5 hover:bg-secondary/20 animate-in fade-in slide-in-from-top-1">
            <span className={trade.side === 'buy' ? 'text-chart-2' : 'text-chart-3'}>
              {trade.price.toFixed(2)}
            </span>
            <span className="text-right text-foreground">
              {trade.amount}
            </span>
            <span className="text-right text-muted-foreground">
              {trade.time}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}