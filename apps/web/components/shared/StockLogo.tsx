"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

function logoUrl(symbol: string) {
  return `https://financialmodelingprep.com/image-stock/${encodeURIComponent(symbol.toUpperCase())}.png`;
}

function initials(symbol: string) {
  return symbol.slice(0, 2).toUpperCase();
}

function hashColor(symbol: string) {
  let hash = 0;
  for (let i = 0; i < symbol.length; i += 1) {
    hash = symbol.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 55% 42%)`;
}

export function StockLogo({
  symbol,
  size = "md",
  className,
}: {
  symbol: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const normalized = symbol.trim().toUpperCase();
  const dim =
    size === "sm" ? "h-6 w-6 text-[9px]" : size === "lg" ? "h-10 w-10 text-xs" : "h-8 w-8 text-[10px]";

  if (!normalized) return null;

  if (failed) {
    return (
      <span
        aria-hidden
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white",
          dim,
          className,
        )}
        style={{ backgroundColor: hashColor(normalized) }}
      >
        {initials(normalized)}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logoUrl(normalized)}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={cn("inline-block shrink-0 rounded-full bg-muted object-cover", dim, className)}
    />
  );
}

export function SymbolWithLogo({
  symbol,
  size = "md",
  className,
  symbolClassName,
}: {
  symbol: string;
  size?: "sm" | "md" | "lg";
  className?: string;
  symbolClassName?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <StockLogo symbol={symbol} size={size} />
      <span className={cn("font-mono font-semibold tracking-wide", symbolClassName)}>{symbol}</span>
    </span>
  );
}
