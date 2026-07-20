"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function SignalConfidenceBadge({
  confidence,
  className,
}: {
  confidence: number;
  className?: string;
}) {
  const pct = Math.round(confidence * 100);
  const variant =
    pct >= 70 ? "success" : pct >= 55 ? "warning" : "secondary";

  return (
    <Badge variant={variant} className={cn("font-mono", className)}>
      {pct}% conf
    </Badge>
  );
}
