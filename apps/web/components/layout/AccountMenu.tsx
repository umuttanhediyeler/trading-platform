"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import {
  ChevronDown,
  HelpCircle,
  Landmark,
  LogOut,
  ShieldCheck,
  UserCog,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { planLabel } from "@/lib/entitlements";
import { cn } from "@/lib/utils";
import type { PlanTier } from "@/lib/types";

const MENU_LINKS = [
  { href: "/settings/account", label: "Hesap Ayarları", icon: UserCog },
  { href: "/settings/billing", label: "Plan & Faturalama", icon: Wallet },
  { href: "/settings/risk", label: "Risk Kontrolleri", icon: ShieldCheck },
  { href: "/settings/broker", label: "Broker Bağlantısı", icon: Landmark },
];

const ITEM_CLASS =
  "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors duration-150 hover:bg-secondary/50 hover:text-foreground";

/** Account dropdown anchored to the user email/avatar in the Topbar. */
export function AccountMenu({
  email,
  planTier,
}: {
  email?: string | null;
  planTier: PlanTier;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const initial = (email ?? "guest").charAt(0).toUpperCase();

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Hesap menüsü"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-2 rounded-full border border-border/60 py-1 pl-1 pr-1 transition-colors duration-150 hover:border-primary/50 md:pr-2.5",
          open && "border-primary/50",
        )}
      >
        <span
          aria-hidden
          className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary/70 font-display text-[11px] font-semibold text-foreground"
        >
          {initial}
        </span>
        <span className="hidden max-w-[160px] truncate text-[11px] uppercase tracking-[0.15em] text-muted-foreground md:inline">
          {email ?? "guest"}
        </span>
        <ChevronDown
          className={cn(
            "hidden h-3 w-3 text-muted-foreground transition-transform duration-200 md:block",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Hesap"
          className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-border bg-card/95 shadow-[0_16px_48px_-12px_rgba(0,0,0,0.7)] backdrop-blur"
        >
          <div className="border-b border-border/60 px-4 py-3">
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground/70">
              ( Hesap )
            </p>
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <p className="truncate text-sm text-foreground">{email ?? "guest"}</p>
              <Badge className="shrink-0 uppercase tracking-[0.2em]">
                {planLabel(planTier)}
              </Badge>
            </div>
          </div>

          <div className="p-1.5">
            {MENU_LINKS.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className={ITEM_CLASS}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </div>

          <div aria-hidden className="mx-4 h-px bg-border/60" />

          <div className="p-1.5">
            <Link
              href="/help"
              role="menuitem"
              onClick={() => setOpen(false)}
              className={ITEM_CLASS}
            >
              <HelpCircle className="h-4 w-4" />
              Yardım
            </Link>
          </div>

          <div aria-hidden className="mx-4 h-px bg-border/60" />

          <div className="p-1.5">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                void signOut({ callbackUrl: "/" });
              }}
              className={cn(
                ITEM_CLASS,
                "text-destructive hover:bg-destructive/10 hover:text-destructive",
              )}
            >
              <LogOut className="h-4 w-4" />
              Çıkış Yap
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
