"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  Cell,
  ReferenceLine,
  Line,
  CartesianGrid,
} from "recharts";
import { Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CandleData {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  range: [number, number];
  wick: [number, number];
  rsi?: number;
}

const generateInitialData = (): CandleData[] => {
  const data: CandleData[] = [];
  let currentPrice = 1.2450; 
  for (let i = 0; i < 100; i++) {
    const vol = 0.005;
    const open = currentPrice;
    const close = open + (Math.random() - 0.48) * vol;
    const high = Math.max(open, close) + Math.random() * 0.002;
    const low = Math.min(open, close) - Math.random() * 0.002;
    data.push({
      time: `12:${i.toString().padStart(2, '0')}`,
      open, high, low, close,
      volume: 100,
      range: [Math.min(open, close), Math.max(open, close)],
      wick: [low, high],
      rsi: 50 + (Math.random() * 20 - 10)
    });
    currentPrice = close;
  }
  return data;
};

export function PriceChart() {
  const [data, setData] = useState<CandleData[]>([]);
  const [hoveredData, setHoveredData] = useState<CandleData | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => setData(generateInitialData()), []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) containerRef.current?.requestFullscreen();
    else document.exitFullscreen();
  };

  const activeOHLC = hoveredData || (data.length > 0 ? data[data.length - 1] : null);

  return (
    <div ref={containerRef} className={`w-full h-full flex flex-col font-data ${isFullscreen ? 'bg-background p-4' : ''}`}>
      <div className="flex items-center gap-4 px-4 py-2 border-b border-border bg-card/10 shrink-0">
        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">EAST/USDT • 1M</span>
        {activeOHLC && (
          <div className="flex gap-3 text-[9px] font-bold">
            <span className="text-muted-foreground">O<span className="text-foreground ml-1">{activeOHLC.open.toFixed(4)}</span></span>
            <span className="text-muted-foreground">H<span className="text-chart-2 ml-1">{activeOHLC.high.toFixed(4)}</span></span>
            <span className="text-muted-foreground">L<span className="text-chart-3 ml-1">{activeOHLC.low.toFixed(4)}</span></span>
            <span className="text-muted-foreground">C<span className="text-foreground ml-1">{activeOHLC.close.toFixed(4)}</span></span>
          </div>
        )}
        <Button variant="ghost" size="icon" onClick={toggleFullscreen} className="ml-auto h-7 w-7 text-muted-foreground">
          {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </Button>
      </div>
      <div className="flex-1 relative mt-2 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data.slice(-60)} onMouseMove={(s) => s.activePayload && setHoveredData(s.activePayload[0].payload)}>
            <CartesianGrid strokeDasharray="1 1" stroke="hsl(var(--border))" opacity={0.2} vertical={false} />
            <XAxis dataKey="time" hide />
            <YAxis orientation="right" tick={{fill: 'hsla(var(--muted-foreground))', fontSize: 10}} axisLine={false} tickFormatter={(v) => v.toFixed(4)} domain={['auto', 'auto']} />
            <Bar dataKey="wick" barSize={1}>{data.slice(-60).map((e, i) => <Cell key={i} fill={e.close > e.open ? "hsl(var(--chart-2))" : "hsl(var(--chart-3))"} />)}</Bar>
            <Bar dataKey="range" barSize={8}>{data.slice(-60).map((e, i) => <Cell key={i} fill={e.close > e.open ? "hsl(var(--chart-2))" : "hsl(var(--chart-3))"} />)}</Bar>
            <ReferenceLine y={data.length > 0 ? data[data.length-1].close : 0} stroke="hsl(var(--primary))" strokeDasharray="3 3" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="h-20 border-t border-border mt-2 relative bg-card/5">
        <span className="absolute top-1 left-4 text-[9px] font-bold text-muted-foreground uppercase">RSI (14)</span>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data.slice(-60)}>
            <CartesianGrid strokeDasharray="1 1" stroke="hsl(var(--border))" opacity={0.1} vertical={false} />
            <XAxis dataKey="time" hide />
            <YAxis orientation="right" tick={{fontSize: 8}} domain={[0, 100]} ticks={[30, 70]} />
            <Line type="monotone" dataKey="rsi" stroke="hsl(var(--primary))" dot={false} strokeWidth={1} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}