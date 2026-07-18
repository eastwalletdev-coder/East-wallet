"use client"

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Hammer, Loader2, KeyRound, CheckCircle2 } from "lucide-react";
import { getLightNodeProducer, type ProducerState } from "@/lib/lightnode/producer";
import { hasLocalVault } from "@/lib/east-self-custody";

function timeAgo(ts: number | null) {
  if (!ts) return "—";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
}

/**
 * Optional, opt-in "become a block producer" panel — separate from the
 * always-on header verification in LightNodePanel.tsx. Requires local
 * self-custody (see east-self-custody.ts); if none is set up, points the
 * user at that flow instead of showing the start controls.
 */
export function ProducerPanel({ telegramId }: { telegramId: string }) {
  const [state, setState] = useState<ProducerState | null>(null);
  const [password, setPassword] = useState("");
  const [vaultExists, setVaultExists] = useState(false);

  useEffect(() => {
    setVaultExists(hasLocalVault());
    const unsub = getLightNodeProducer().subscribe(setState);
    return () => { unsub(); };
  }, []);

  if (!vaultExists) {
    return (
      <Card className="bg-card/40 border-border/30">
        <CardContent className="p-4 space-y-2">
          <p className="text-[10px] text-muted-foreground uppercase font-black flex items-center gap-1">
            <Hammer className="w-3 h-3" /> Producer Mode
          </p>
          <p className="text-[11px] text-white/50 leading-relaxed">
            Set up self-custody first to be eligible as a block producer — see the Secure Wallet option in your wallet settings.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!state) return null;

  const isRunning = state.status === "running";
  const isUnlocking = state.status === "unlocking";

  return (
    <Card className="bg-card/40 border-border/30">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[10px] text-muted-foreground uppercase font-black flex items-center gap-1">
            <Hammer className="w-3 h-3" /> Producer Mode
          </p>
          {isRunning && (
            <Badge className="bg-green-500/10 text-green-400 border-green-500/20 text-[9px] uppercase font-black">
              <CheckCircle2 className="w-3 h-3 mr-1" /> Active
            </Badge>
          )}
        </div>

        <p className="text-[10px] text-white/40 leading-relaxed">
          When enabled, this device heartbeats in and becomes eligible to be assigned block production — highest PoC score currently online gets picked first.
        </p>

        {!isRunning ? (
          <>
            <Input
              type="password"
              placeholder="Self-custody vault password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-10 bg-secondary/30 rounded-xl text-[11px]"
              disabled={isUnlocking}
            />
            {state.status === "error" && state.lastError && (
              <p className="text-[10px] text-red-400">{state.lastError}</p>
            )}
            <Button
              className="w-full h-10 rounded-xl text-[10px] uppercase font-bold gap-2"
              disabled={isUnlocking || !password}
              onClick={() => getLightNodeProducer().start(telegramId, password)}
            >
              {isUnlocking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
              {isUnlocking ? "Unlocking…" : "Start Producer Mode"}
            </Button>
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-[8px] text-muted-foreground uppercase font-bold">Last Heartbeat</p>
                <p className="text-[11px] text-white font-bold">{timeAgo(state.lastHeartbeatAt)}</p>
              </div>
              <div>
                <p className="text-[8px] text-muted-foreground uppercase font-bold">Blocks Produced</p>
                <p className="text-[11px] text-white font-bold">{state.blocksProduced}</p>
              </div>
            </div>
            <Button
              variant="ghost"
              className="w-full h-10 rounded-xl text-[10px] uppercase font-bold"
              onClick={() => getLightNodeProducer().stop()}
            >
              Stop Producer Mode
            </Button>
          </>
        )}

        {state.log.length > 0 && (
          <div className="space-y-1 max-h-32 overflow-y-auto pt-1 border-t border-white/5">
            {[...state.log].reverse().slice(0, 8).map((entry, i) => (
              <div key={i} className="flex items-center gap-2 text-[9px]">
                <span className="text-white/25 font-code">
                  {new Date(entry.time).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="text-white/50">{entry.message}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
