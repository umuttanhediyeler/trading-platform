"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ScanCondition } from "@/lib/types";

const FIELD_LABELS: Record<string, string> = {
  volume_ratio: "Vol ratio",
  gap_percent: "Gap %",
  rsi_14: "RSI 14",
  price_vs_vwap: "vs VWAP",
  atr_percent: "ATR %",
  change_percent: "Change %",
};

export function FilterChip({
  condition,
  onRemove,
  className,
}: {
  condition: ScanCondition;
  onRemove?: () => void;
  className?: string;
}) {
  const label = FIELD_LABELS[condition.field] ?? condition.field;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/60 px-2 py-1 font-mono text-xs text-foreground",
        className,
      )}
    >
      <span className="text-muted-foreground">{label}</span>
      <span>{condition.op}</span>
      <span className="text-primary">{condition.value}</span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          className="ml-0.5 rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
          aria-label="Remove filter"
        >
          <X className="h-3 w-3" />
        </button>
      ) : null}
    </span>
  );
}
