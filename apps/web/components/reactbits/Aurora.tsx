"use client";

import { cn } from "@/lib/utils";

/**
 * ReactBits-style "Aurora" animated gradient backdrop. Pure CSS so it stays
 * cheap; sits behind content with pointer-events disabled.
 */
export function Aurora({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}
    >
      <div className="aurora-blob left-[-10%] top-[-20%] h-[50vh] w-[50vw] bg-primary/15" />
      <div
        className="aurora-blob right-[-15%] top-[10%] h-[45vh] w-[45vw] bg-accent/10"
        style={{ animationDelay: "-6s" }}
      />
      <div
        className="aurora-blob bottom-[-25%] left-[20%] h-[55vh] w-[55vw] bg-foreground/10"
        style={{ animationDelay: "-12s" }}
      />
    </div>
  );
}
