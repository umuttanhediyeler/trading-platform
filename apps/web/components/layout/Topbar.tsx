"use client";

import Link from "next/link";
import { Moon, Sun } from "lucide-react";
import { KillSwitchButton } from "@/components/risk/KillSwitchButton";
import { AccountMenu } from "@/components/layout/AccountMenu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useExecutionStore } from "@/lib/store";
import { planLabel } from "@/lib/entitlements";
import type { PlanTier } from "@/lib/types";

export function Topbar({
  email,
  token,
  planTier,
}: {
  email?: string | null;
  token?: string | null;
  planTier?: PlanTier;
}) {
  const theme = useExecutionStore((s) => s.theme);
  const toggleTheme = useExecutionStore((s) => s.toggleTheme);
  const executionMode = useExecutionStore((s) => s.executionMode);
  const killSwitchActive = useExecutionStore((s) => s.killSwitchActive);
  const storeTier = useExecutionStore((s) => s.planTier);
  // AppShell refreshes the store from /users/me, so it also reflects plan
  // upgrades made after the current NextAuth cookie was issued.
  const tier = storeTier;

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b border-border/60 bg-background/80 px-4 backdrop-blur-md lg:px-6">
      <div className="flex min-w-0 items-center gap-4">
        <Link
          href="/"
          className="truncate font-display text-sm font-semibold tracking-tight lg:hidden"
        >
          Apex Scan
          <span className="align-super text-[9px] text-muted-foreground">®</span>
        </Link>
        <div className="hidden items-center gap-2 sm:flex">
          <Badge className="uppercase tracking-[0.2em]">{planLabel(tier)}</Badge>
          <Badge variant="outline" className="font-mono">
            mode:{executionMode}
          </Badge>
          {killSwitchActive ? (
            <Badge variant="warning" className="uppercase tracking-[0.2em]">
              automation halted
            </Badge>
          ) : null}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <KillSwitchButton token={token} />
        <span aria-hidden className="hidden h-5 w-px bg-border/80 sm:block" />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          aria-label="Toggle theme"
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
        <AccountMenu email={email} planTier={tier} />
      </div>
    </header>
  );
}
