"use client"

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Wifi, WifiOff, Loader2, Radio, ShieldCheck, Gauge, Download } from "lucide-react";
import { getLightNodeClient, type LightNodeState } from "@/lib/lightnode/client";

function timeAgo(ts: number | null) {
  if (!ts) return "—";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
}

export function LightNodePanel() {
  const [state, setState] = useState<LightNodeState | null>(null);

  useEffect(() => {
    const client = getLightNodeClient();
    const unsub = client.subscribe(setState);
    client.connect();
    return () => { unsub(); };
  }, []);

  if (!state) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-primary" />
      </div>
    );
  }

  const isOnline = state.connectionStatus === "connected";
  const isSyncing = state.syncPhase === "downloading" || state.syncPhase === "validating";
  const participationPct = Math.min(100, Math.round((state.participationSeconds / 120) * 100));

  return (
    <div className="space-y-3">
      {/* Status header */}
      <Card className="bg-card/40 border-border/30">
        <CardContent className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isOnline ? (
              <Wifi className="w-4 h-4 text-green-500" />
            ) : state.connectionStatus === "connecting" ? (
              <Loader2 className="w-4 h-4 text-yellow-500 animate-spin" />
            ) : (
              <WifiOff className="w-4 h-4 text-red-500" />
            )}
            <span className="text-white text-sm font-bold uppercase">
              {isOnline ? "Node Online" : state.connectionStatus === "connecting" ? "Connecting" : "Offline"}
            </span>
          </div>
          {state.eligible && (
            <Badge className="bg-green-500/10 text-green-400 border-green-500/20 text-[9px] uppercase font-black">
              <ShieldCheck className="w-3 h-3 mr-1" /> Reward Eligible
            </Badge>
          )}
        </CardContent>
      </Card>

      {/* Live sync animation — only shown while actively downloading/validating */}
      {isSyncing && (
        <Card className="bg-primary/5 border-primary/20 overflow-hidden">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              {state.syncPhase === "downloading" ? (
                <Download className="w-4 h-4 text-primary animate-bounce" />
              ) : (
                <ShieldCheck className="w-4 h-4 text-primary animate-pulse" />
              )}
              <span className="text-primary text-[11px] font-black uppercase tracking-widest">
                {state.syncPhase === "downloading" ? "Downloading Blocks" : "Validating Headers"}
              </span>
            </div>

            {/* Step dots — one per block being backfilled */}
            <div className="flex items-center gap-1.5">
              {Array.from({ length: Math.max(state.syncProgress.total, 1) }).map((_, i) => {
                const stepNum = i + 1;
                const done = stepNum < state.syncProgress.current ||
                  (stepNum === state.syncProgress.current && state.syncPhase === "validating");
                const active = stepNum === state.syncProgress.current && state.syncPhase === "downloading";
                return (
                  <div
                    key={i}
                    className={`h-1.5 flex-1 rounded-full transition-all duration-500 ${
                      done ? "bg-primary" : active ? "bg-primary/50 animate-pulse" : "bg-white/10"
                    }`}
                  />
                );
              })}
            </div>

            <p className="text-[10px] text-white/40 font-code">
              Block {state.syncProgress.current}/{state.syncProgress.total || "?"} ·
              {" "}Verifying hash & validator signature…
            </p>
          </CardContent>
        </Card>
      )}

      {/* Telemetry grid */}
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Session ID" value={state.nodeId.slice(0, 13) + "…"} mono />
        <Stat label="Latency" value={state.latencyMs != null ? `${state.latencyMs} ms` : "—"} />
        <Stat label="Current Height" value={state.currentHeight >= 0 ? `#${state.currentHeight}` : "—"} />
        <Stat label="Last Heartbeat" value={timeAgo(state.lastHeartbeat)} />
        <Stat label="Last Claim Epoch" value={state.lastClaimEpoch || "—"} />
        <Stat label="Connection" value={state.connectionStatus} />
      </div>

      {/* Participation progress */}
      <Card className="bg-card/40 border-border/30">
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground uppercase font-black flex items-center gap-1">
              <Gauge className="w-3 h-3" /> Participation Score
            </span>
            <span className="text-primary text-xs font-code font-bold">{participationPct}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${participationPct}%` }} />
          </div>
          <p className="text-[9px] text-white/30">
            {state.verifiedHeaderCount}/2 headers verified · {Math.min(120, state.participationSeconds)}/120s active
          </p>
        </CardContent>
      </Card>

      {/* Event log */}
      <Card className="bg-card/40 border-border/30">
        <CardContent className="p-4">
          <p className="text-[10px] text-muted-foreground uppercase font-black mb-2 flex items-center gap-1">
            <Radio className="w-3 h-3" /> Activity Log
          </p>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {state.log.length === 0 ? (
              <p className="text-white/20 text-[10px]">No activity yet.</p>
            ) : (
              [...state.log].reverse().map((entry, i) => (
                <div key={i} className="flex items-center gap-2 text-[10px]">
                  <span className="text-white/25 font-code">
                    {new Date(entry.time).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span className="text-white/60">{entry.message}</span>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      {!isOnline && (
        <Button
          onClick={() => getLightNodeClient().connect()}
          className="w-full h-11 rounded-xl bg-primary hover:bg-primary/90 text-white font-black uppercase text-[10px]"
        >
          Reconnect
        </Button>
      )}
    </div>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <Card className="bg-card/20 border-border/20">
      <CardContent className="p-3">
        <p className="text-[8px] text-muted-foreground uppercase font-bold">{label}</p>
        <p className={`text-[11px] text-white font-bold truncate ${mono ? "font-code" : ""}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
