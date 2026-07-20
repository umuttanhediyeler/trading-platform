"use client";

import { cn } from "@/lib/utils";

/**
 * ReactBits-style "shiny text": a bright highlight sweeps across the text.
 * Pure CSS (background-clip) — no JS per frame.
 */
export function ShinyText({
  children,
  className,
  speed = 3,
}: {
  children: React.ReactNode;
  className?: string;
  /** Sweep duration in seconds. */
  speed?: number;
}) {
  return (
    <span
      className={cn("animate-shine bg-clip-text text-transparent", className)}
      style={{
        backgroundImage:
          "linear-gradient(120deg, hsl(var(--foreground) / 0.45) 40%, hsl(var(--foreground)) 50%, hsl(var(--foreground) / 0.45) 60%)",
        backgroundSize: "200% 100%",
        animationDuration: `${speed}s`,
      }}
    >
      {children}
    </span>
  );
}
