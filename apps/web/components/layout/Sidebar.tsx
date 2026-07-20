"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BarChart3,
  BrainCircuit,
  FlaskConical,
  LayoutDashboard,
  LineChart,
  ListOrdered,
  Radar,
  Settings,
  Wallet,
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
  const items = NAV.slice(0, 5);

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border/60 bg-background/90 backdrop-blur-md lg:hidden">
      {items.map((item) => {
        const active = pathname === item.href;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex flex-1 flex-col items-center gap-1 py-2 text-[10px] transition-colors duration-200",
              active ? "text-primary" : "text-muted-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
