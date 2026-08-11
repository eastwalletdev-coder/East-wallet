"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

/**
 * Light / dark switch — place on Profile (and optional header).
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={toggle}
      className={cn(
        "flex items-center justify-between w-full gap-3 rounded-2xl border border-border/60 bg-secondary/40 px-4 py-3 transition-colors hover:bg-secondary/60",
        className,
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-9 h-9 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0">
          {isDark ? (
            <Moon className="w-4 h-4 text-primary" />
          ) : (
            <Sun className="w-4 h-4 text-primary" />
          )}
        </div>
        <div className="text-left min-w-0">
          <p className="text-sm font-bold text-foreground">Appearance</p>
          <p className="text-[11px] text-muted-foreground">
            {isDark ? "Dark mode" : "Light mode"}
          </p>
        </div>
      </div>
      <div
        className={cn(
          "relative h-7 w-12 rounded-full transition-colors shrink-0",
          isDark ? "bg-primary/40" : "bg-primary",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform",
            isDark ? "translate-x-0" : "translate-x-5",
          )}
        />
      </div>
    </button>
  );
}

/** Compact icon toggle for top bars */
export function ThemeToggleIcon({ className }: { className?: string }) {
  const { theme, toggle } = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle theme"
      className={cn(
        "h-9 w-9 rounded-full border border-border/50 bg-secondary/50 flex items-center justify-center text-foreground",
        className,
      )}
    >
      {theme === "dark" ? (
        <Sun className="w-4 h-4" />
      ) : (
        <Moon className="w-4 h-4" />
      )}
    </button>
  );
}
