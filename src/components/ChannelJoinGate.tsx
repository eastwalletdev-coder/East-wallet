"use client";

import { useEffect, useState, useCallback } from "react";
import { useTelegram } from "@/hooks/use-telegram";
import { verifyRequiredChannel } from "@/actions/channel-gate-actions";
import { Button } from "@/components/ui/button";
import { Loader2, Radio } from "lucide-react";

const DEFAULT_CHANNEL = "@Eastnetworkupdate";
const DEFAULT_INVITE = "https://t.me/Eastnetworkupdate";

function getTg() {
  if (typeof window === "undefined") return null;
  return (window as any).Telegram?.WebApp ?? null;
}

/** Prefer live WebApp fields — hook initData can be empty on first paint. */
function resolveIdentity(hookUserId: string | number | null | undefined, hookInitData: string | undefined) {
  const tg = getTg();
  const userId =
    hookUserId != null && String(hookUserId)
      ? String(hookUserId)
      : tg?.initDataUnsafe?.user?.id != null
        ? String(tg.initDataUnsafe.user.id)
        : "";
  const initData =
    (hookInitData && hookInitData.length > 0 ? hookInitData : "") ||
    (tg?.initData && String(tg.initData).length > 0 ? String(tg.initData) : "");
  return { userId, initData };
}

function openChannel(url: string) {
  const tg = getTg();
  const link = url.startsWith("http") ? url : `https://t.me/${url.replace(/^@/, "")}`;
  try {
    // Mini App: openTelegramLink keeps user inside Telegram client
    if (tg && typeof tg.openTelegramLink === "function") {
      tg.openTelegramLink(link);
      return;
    }
    if (tg && typeof tg.openLink === "function") {
      tg.openLink(link, { try_instant_view: false });
      return;
    }
  } catch {
    /* fall through */
  }
  try {
    window.open(link, "_blank", "noopener,noreferrer");
  } catch {
    window.location.href = link;
  }
}

/**
 * Full-screen gate: user must join @Eastnetworkupdate before using the app.
 * Skipped outside Telegram (no userId) so browser/dev still works.
 */
export function ChannelJoinGate({ children }: { children: React.ReactNode }) {
  const { userId: hookUserId, initData: hookInitData } = useTelegram();
  const [checking, setChecking] = useState(true);
  const [joined, setJoined] = useState(false);
  const [inviteLink, setInviteLink] = useState(DEFAULT_INVITE);
  const [channel, setChannel] = useState(DEFAULT_CHANNEL);
  const [error, setError] = useState<string | null>(null);
  const [statusHint, setStatusHint] = useState<string | null>(null);

  const check = useCallback(async () => {
    const { userId, initData } = resolveIdentity(hookUserId, hookInitData);

    if (!userId) {
      // Wait a moment for Telegram script — then allow browser/dev
      setChecking(true);
      await new Promise((r) => setTimeout(r, 600));
      const again = resolveIdentity(hookUserId, hookInitData);
      if (!again.userId) {
        setJoined(true);
        setChecking(false);
        return;
      }
      return checkWith(again.userId, again.initData);
    }
    return checkWith(userId, initData);
  }, [hookUserId, hookInitData]);

  async function checkWith(userId: string, initData: string) {
    setChecking(true);
    setError(null);
    setStatusHint(null);
    try {
      const res = await verifyRequiredChannel(userId, initData || undefined);
      if (res.inviteLink) setInviteLink(res.inviteLink);
      if (res.channel) setChannel(res.channel);

      if (res.joined) {
        setJoined(true);
        setChecking(false);
        return;
      }

      setJoined(false);
      // Always surface why (including BOT_TOKEN_MISSING)
      if (res.error) {
        setError(res.error);
      } else if (res.status && res.status !== "member") {
        setStatusHint(`Telegram status: ${res.status}`);
      }
      if (res.error === "BOT_TOKEN_MISSING") {
        setError("Server misconfigured: TELEGRAM_BOT_TOKEN is missing on Vercel");
      }
      if (res.error === "IDENTITY_VIOLATION" || res.error === "IDENTITY_MISMATCH") {
        setError("Telegram identity check failed — close and reopen the Mini App");
      }
      // Common Bot API errors when bot is not admin
      if (res.error && /member list is inaccessible|chat not found|not enough rights/i.test(res.error)) {
        setError(
          "Bot cannot read channel members — add the bot as administrator of " +
            (res.channel || DEFAULT_CHANNEL),
        );
      }
    } catch (e: any) {
      setError(e?.message || "Check failed");
      setJoined(false);
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    check();
  }, [check]);

  if (joined) return <>{children}</>;

  if (checking) {
    return (
      <div className="fixed inset-0 z-[90] flex flex-col items-center justify-center bg-[#050508] gap-3">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
        <p className="text-white/50 text-xs uppercase tracking-widest">Checking channel…</p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[90] flex flex-col items-center justify-center bg-[#050508] px-6 text-center gap-5">
      <div className="w-14 h-14 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center">
        <Radio className="w-7 h-7 text-primary" />
      </div>
      <div className="space-y-2 max-w-sm">
        <h1 className="text-white font-black text-lg tracking-tight">Join the Official Channel</h1>
        <p className="text-white/55 text-sm leading-relaxed">
          To use EAST Mini App you must join{" "}
          <button
            type="button"
            className="text-primary font-bold underline underline-offset-2"
            onClick={() => openChannel(inviteLink)}
          >
            {channel}
          </button>
          . Stay updated on network status and security notices.
        </p>
        {error && <p className="text-amber-400/90 text-[11px] break-words leading-snug">{error}</p>}
        {statusHint && !error && (
          <p className="text-white/40 text-[11px]">{statusHint}</p>
        )}
      </div>
      <Button
        className="w-full max-w-xs h-12 rounded-xl font-black uppercase tracking-wider"
        onClick={() => openChannel(inviteLink)}
      >
        Open {channel}
      </Button>
      <Button
        variant="outline"
        className="w-full max-w-xs h-11 rounded-xl border-white/15 text-white/80 font-bold uppercase text-xs tracking-wider"
        disabled={checking}
        onClick={() => check()}
      >
        {checking ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Checking…
          </>
        ) : (
          "I joined — Continue"
        )}
      </Button>
      <p className="text-white/30 text-[10px] max-w-xs">
        After joining, wait 1–2 seconds, then press Continue. The bot must be an admin of the
        channel for verification to work.
      </p>
    </div>
  );
}
