"use client"

import { LightNodePanel } from "@/components/LightNodePanel";
import { ProducerPanel } from "@/components/ProducerPanel";
import { useTelegram } from "@/hooks/use-telegram";
import { Radio } from "lucide-react";

export default function LightNodePage() {
  const { userId } = useTelegram();

  return (
    <div className="px-3 pt-4 pb-24 space-y-4">
      <div>
        <p className="text-white/40 text-[10px] uppercase font-black tracking-widest flex items-center gap-1">
          <Radio className="w-3 h-3" /> Light Node
        </p>
        <h1 className="font-headline font-bold text-2xl text-white">Network Relay</h1>
        <p className="text-white/30 text-[11px] mt-1">
          Your device verifies incoming blocks and helps relay the network —
          no full chain storage needed. Stay connected to become reward-eligible.
        </p>
      </div>

      <LightNodePanel />

      {userId && <ProducerPanel telegramId={userId} />}
    </div>
  );
}
