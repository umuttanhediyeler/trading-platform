"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Activity,
  BarChart3,
  BrainCircuit,
  FlaskConical,
  LayoutDashboard,
  LineChart,
  ListOrdered,
  Menu,
  Radar,
  Settings,
  Wallet,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_SECTIONS = [
  {
    label: "Terminal",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/scanner", label: "Scanner", icon: Radar },
      { href: "/signals", label: "Signals", icon: Activity },
    ],
  },
  {
    label: "Strategy",
    items: [
      { href: "/backtest", label: "Backtest", icon: LineChart },
      { href: "/simulation", label: "Simülasyon", icon: FlaskConical },
      { href: "/orders", label: "Emirler", icon: ListOrdered },
      { href: "/models", label: "Models", icon: BrainCircuit },
    ],
  },
  {
    label: "Account",
    items: [
      { href: "/settings/billing", label: "Billing", icon: Wallet },
      { href: "/settings/broker", label: "Broker", icon: BarChart3 },
      { href: "/settings/risk", label: "Risk", icon: Settings },
    ],
  },
];

const NAV = NAV_SECTIONS.flatMap((section) => section.items);

const MOBILE_TABS = [
  { href: "/dashboard", label: "Ana", icon: LayoutDashboard },
  { href: "/scanner", label: "Tara", icon: Radar },
  { href: "/signals", label: "Sinyal", icon: Activity },
  { href: "/orders", label: "Emir", icon: ListOrdered },
];

export function Sidebar({ className }: { className?: string }) {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        "hidden h-full w-56 shrink-0 flex-col border-r border-border/60 bg-background lg:flex",
        className,
      )}
    >
      <div className="border-b border-border/60 px-5 py-5">
        <Link href="/dashboard" className="block">
          <p className="font-display text-lg font-semibold tracking-tight text-foreground">
            Apex Scan
            <span className="align-super text-[10px] text-muted-foreground">®</span>
          </p>
          <p className="mt-1 text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
            Trading Terminal
          </p>
        </Link>
      </div>
      <nav className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-5">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label}>
            <p className="px-3 pb-2 text-[10px] uppercase tracking-[0.3em] text-muted-foreground/70">
              {section.label}
            </p>
            <div className="flex flex-col gap-0.5">
              {section.items.map((item) => {
                const active =
                  pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-all duration-200",
                      active
                        ? "bg-secondary/60 text-foreground"
                        : "text-muted-foreground hover:bg-secondary/40 hover:text-foreground",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-primary transition-opacity duration-200",
                        active ? "opacity-100" : "opacity-0 group-hover:opacity-40",
                      )}
                    />
                    <Icon
                      className={cn(
                        "h-4 w-4 transition-colors duration-200",
                        active
                          ? "text-primary"
                          : "text-muted-foreground group-hover:text-foreground",
                      )}
                    />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t border-border/60 px-5 py-4 text-[10px] leading-relaxed text-muted-foreground/70">
        Delayed/free data by default. Live licensed feeds and real-money automation require
        explicit broker + risk setup.
      </div>
    </aside>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden">
        <div className="flex items-stretch">
          {MOBILE_TABS.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[10px] font-medium transition-colors duration-200",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                <Icon className={cn("h-5 w-5", active && "scale-110")} />
                {item.label}
              </Link>
            );
          })}
          <button
            type="button"
            aria-expanded={menuOpen}
            aria-label="Menüyü aç"
            onClick={() => setMenuOpen(true)}
            className={cn(
              "flex min-h-[56px] min-w-[4.5rem] flex-col items-center justify-center gap-0.5 px-2 py-2 text-[10px] font-medium transition-colors",
              menuOpen ? "text-primary" : "text-muted-foreground",
            )}
          >
            <Menu className="h-5 w-5" />
            Menü
          </button>
        </div>
      </nav>

      {menuOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Menüyü kapat"
            className="absolute inset-0 bg-background/70 backdrop-blur-sm"
            onClick={() => setMenuOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-hidden rounded-t-3xl border border-border/60 bg-card shadow-2xl motion-safe:animate-sheet-up">
            <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
              <div>
                <p className="font-display text-lg font-semibold">Apex Scan</p>
                <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                  Tüm sayfalar
                </p>
              </div>
              <button
                type="button"
                aria-label="Kapat"
                onClick={() => setMenuOpen(false)}
                className="rounded-full p-2 text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-[calc(85vh-4rem)] overflow-y-auto px-3 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              {NAV_SECTIONS.map((section) => (
                <div key={section.label} className="mb-5">
                  <p className="px-3 pb-2 text-[10px] uppercase tracking-[0.3em] text-muted-foreground/70">
                    {section.label}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {section.items.map((item) => {
                      const active =
                        pathname === item.href || pathname.startsWith(`${item.href}/`);
                      const Icon = item.icon;
                      const inPrimary = MOBILE_TABS.some((tab) => tab.href === item.href);
                      if (inPrimary) return null;
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          className={cn(
                            "flex items-center gap-2.5 rounded-xl border px-3 py-3 text-sm transition-colors",
                            active
                              ? "border-primary/40 bg-primary/10 text-foreground"
                              : "border-border/60 bg-background/60 text-muted-foreground hover:text-foreground",
                          )}
                        >
                          <Icon className={cn("h-4 w-4 shrink-0", active && "text-primary")} />
                          <span className="truncate">{item.label}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export { NAV, NAV_SECTIONS };
