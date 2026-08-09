"use client";

import { useEffect, useState, useCallback } from "react";
import { useTelegram } from "@/hooks/use-telegram";
import { verifyRequiredChannel } from "@/actions/channel-gate-actions";
import { Button } from "@/components/ui/button";
import { Loader2, Radio } from "lucide-react";

/**
 * Full-screen gate: user must join @Eastnetwork before using the app.
 * Skipped outside Telegram (no userId) so browser/dev still works.
 */
export function ChannelJoinGate({ children }: { children: React.ReactNode }) {
  const { userId, initData } = useTelegram();
  const [checking, setChecking] = useState(true);
  const [joined, setJoined] = useState(false);
  const [inviteLink, setInviteLink] = useState("https://t.me/Eastnetwork");
  const [channel, setChannel] = useState("@Eastnetwork");
  const [error, setError] = useState<string | null>(null);

  const check = useCallback(async () => {
    if (!userId) {
      // Not in Telegram WebApp — do not block local/browser testing
      setJoined(true);
      setChecking(false);
      return;
    }
    setChecking(true);
    setError(null);
    try {
      const res = await verifyRequiredChannel(String(userId), initData);
      if (res.inviteLink) setInviteLink(res.inviteLink);
      if (res.channel) setChannel(res.channel);
      if (res.joined) {
        setJoined(true);
      } else {
        setJoined(false);
        if (res.error && res.error !== "BOT_TOKEN_MISSING") {
          setError(res.error);
        }
      }
    } catch (e: any) {
      setError(e?.message || "Check failed");
      setJoined(false);
    } finally {
      setChecking(false);
    }
  }, [userId, initData]);

  useEffect(() => {
    check();
  }, [check]);

  if (checking) {
    return (
      <div className="fixed inset-0 z-[90] flex flex-col items-center justify-center bg-[#050508] gap-3">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        <p className="text-white/50 text-xs uppercase tracking-widest">Checking channel…</p>
      </div>
    );
  }

  if (!joined) {
    return (
      <div className="fixed inset-0 z-[90] flex flex-col items-center justify-center bg-[#050508] px-6 text-center gap-5">
        <div className="w-14 h-14 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center">
          <Radio className="w-7 h-7 text-primary" />
        </div>
        <div className="space-y-2 max-w-sm">
          <h1 className="text-white font-black text-lg tracking-tight">Join the Official Channel</h1>
          <p className="text-white/55 text-sm leading-relaxed">
            To use EAST Mini App you must join{" "}
            <span className="text-primary font-bold">{channel}</span>. This keeps the community
            updated on network status and security notices.
          </p>
          {error && (
            <p className="text-amber-400/90 text-[11px] break-all">{error}</p>
          )}
        </div>
        <Button
          className="w-full max-w-xs h-12 rounded-xl font-black uppercase tracking-wider"
          onClick={() => {
            try {
              const tg = (window as any).Telegram?.WebApp;
              if (tg?.openTelegramLink) tg.openTelegramLink(inviteLink);
              else window.open(inviteLink, "_blank");
            } catch {
              window.open(inviteLink, "_blank");
            }
          }}
        >
          Join {channel}
        </Button>
        <Button
          variant="outline"
          className="w-full max-w-xs h-11 rounded-xl border-white/15 text-white/80 font-bold uppercase text-xs tracking-wider"
          onClick={() => check()}
        >
          I joined — Continue
        </Button>
      </div>
    );
  }

  return <>{children}</>;
}
