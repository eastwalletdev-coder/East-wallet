"use client";

import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

interface FullNodeConsentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void> | void;
  loading?: boolean;
}

export function FullNodeConsentDialog({ open, onOpenChange, onConfirm, loading }: FullNodeConsentDialogProps) {
  const [checked, setChecked] = useState(false);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!loading) { onOpenChange(v); if (!v) setChecked(false); } }}>
      <DialogContent className="bg-background border-white/20 rounded-[2rem] max-w-[380px]">
        <DialogHeader>
          <div className="flex flex-col items-center gap-2 pt-2">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/20 flex items-center justify-center">
              <AlertTriangle className="w-6 h-6 text-amber-500" />
            </div>
            <DialogTitle className="text-white text-center">Full Lightnode Agreement</DialogTitle>
          </div>
        </DialogHeader>

        <div className="space-y-3 py-2 text-[12px] leading-relaxed text-white/70">
          <p>
            Enabling <span className="text-white font-bold">Full Lightnode</span> mode makes this
            device maintain a local replica of the EASTCHAIN balance ledger, stored in this
            browser's/Telegram's local storage. Other users' balance queries may be routed to your
            node for faster reads.
          </p>

          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 space-y-1.5">
            <p className="text-red-400 font-bold text-[11px] uppercase tracking-wide">
              Do not clear browser or Telegram data
            </p>
            <p className="text-white/80">
              Your ledger replica is stored <span className="font-bold">only</span> in this
              browser's/Telegram's local storage. Clearing browser data, clearing Telegram's cache,
              uninstalling/reinstalling, or switching devices without properly migrating will erase
              it.
            </p>
          </div>

          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 space-y-1.5">
            <p className="text-red-400 font-bold text-[11px] uppercase tracking-wide">
              Sanctions for registered nodes
            </p>
            <p className="text-white/80">
              If a registered Full Lightnode is found to have cleared its browser/Telegram data,
              sanctions apply — ranging from slashing, to suspension, up to a permanent ban from
              participating in the EAST network. Registering as a Full Lightnode means accepting
              responsibility for keeping this device's data intact for as long as the node stays
              registered.
            </p>
          </div>

          <p className="text-white/50 text-[11px]">
            You can disable Full Lightnode mode at any time from the Validator Panel. This does not
            retroactively excuse a data-loss event that already occurred while registered.
          </p>
        </div>

        <label className="flex items-start gap-2.5 py-2 cursor-pointer">
          <Checkbox
            checked={checked}
            onCheckedChange={(v) => setChecked(v === true)}
            className="mt-0.5"
          />
          <span className="text-[11px] text-white/80 leading-snug">
            I have read and understood the above. I accept responsibility for preserving this
            device's browser/Telegram data for as long as I remain a registered Full Lightnode, and
            I understand the sanctions described above apply if I fail to do so.
          </span>
        </label>

        <Button
          disabled={!checked || loading}
          onClick={onConfirm}
          className="w-full h-12 rounded-2xl bg-white text-black font-black uppercase text-[10px] tracking-widest"
        >
          {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
          {loading ? "Registering..." : "I Agree — Enable Full Lightnode"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
