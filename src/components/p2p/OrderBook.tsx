"use client";

import { useEffect, useState } from "react";

interface OrderBookProps {
  tradingPair?: string;
}

const generateOrders = (start: number, count: number, step: number) => {
  return Array.from({ length: count }, (_, i) => ({
    price: start + i * step,
    amount: (Math.random() * 500).toFixed(2),
    total: (Math.random() * 2000).toFixed(2),
    percent: Math.random() * 100,
  }));
};

export function OrderBook({ tradingPair = "EAST/USDT" }: OrderBookProps) {
  const [asks, setAsks] = useState<any[]>([]);
  const [bids, setBids] = useState<any[]>([]);
  const [base, quote] = tradingPair.split("/");

  useEffect(() => {
    const basePrice = base === "BTC" ? 41205.80 : 1.2450;
    const step = base === "BTC" ? 0.5 : 0.0005;
    
    setAsks(generateOrders(basePrice + step, 15, step).reverse());
    setBids(generateOrders(basePrice - step, 15, -step));
  }, [tradingPair, base]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden select-none">
      <div className="p-4 flex items-center justify-between shrink-0">
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Order Book</span>
        <div className="flex items-center gap-2">
           <span className="text-[10px] text-muted-foreground">Prec: {base === "BTC" ? "0.1" : "0.0001"}</span>
        </div>
      </div>
      
      <div className="grid grid-cols-3 px-4 py-2 text-[10px] font-semibold text-muted-foreground border-b border-border uppercase shrink-0">
        <span>Price ({quote})</span>
        <span className="text-right">Amount ({base})</span>
        <span className="text-right">Total</span>
      </div>

      <div className="flex-1 overflow-auto font-data text-[11px]">
        {/* Asks (Sells) */}
        <div className="flex flex-col">
          {asks.map((order, i) => (
            <div key={`ask-${i}`} className="grid grid-cols-3 px-4 py-0.5 relative group hover:bg-chart-3/5">
              <div className="absolute right-0 top-0 bottom-0 bg-chart-3/10 transition-all pointer-events-none" style={{ width: `${order.percent}%` }} />
              <span className="text-chart-3 z-10">{base === "BTC" ? order.price.toFixed(1) : order.price.toFixed(4)}</span>
              <span className="text-right z-10">{order.amount}</span>
              <span className="text-right text-muted-foreground z-10">{order.total}</span>
            </div>
          ))}
        </div>

        {/* Spread / Mid Price */}
        <div className="my-3 py-2 px-4 bg-secondary/30 flex flex-col">
           <div className="flex items-center justify-between">
              <span className="text-lg font-bold text-chart-2">
                {base === "BTC" ? "41,205.80" : "1.2450"}
              </span>
              <span className="text-xs text-muted-foreground">
                ${base === "BTC" ? "41,205.80" : "1.2450"}
              </span>
           </div>
        </div>

        {/* Bids (Buys) */}
        <div className="flex flex-col">
          {bids.map((order, i) => (
            <div key={`bid-${i}`} className="grid grid-cols-3 px-4 py-0.5 relative group hover:bg-chart-2/5">
              <div className="absolute right-0 top-0 bottom-0 bg-chart-2/10 transition-all pointer-events-none" style={{ width: `${order.percent}%` }} />
              <span className="text-chart-2 z-10">{base === "BTC" ? order.price.toFixed(1) : order.price.toFixed(4)}</span>
              <span className="text-right z-10">{order.amount}</span>
              <span className="text-right text-muted-foreground z-10">{order.total}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
