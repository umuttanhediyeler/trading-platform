"use client";

import { useState } from "react";
import { Check, HelpCircle, Minus } from "lucide-react";
import { Aurora } from "@/components/reactbits/Aurora";
import { FadeIn } from "@/components/reactbits/FadeIn";
import { GradientText } from "@/components/reactbits/GradientText";
import { SpecularButton } from "@/components/reactbits/SpecularButton";
import { SpotlightCard } from "@/components/reactbits/SpotlightCard";
import { HELP_SECTIONS } from "@/lib/help-content";
import { cn } from "@/lib/utils";

export default function HelpPage() {
  const [activeId, setActiveId] = useState(HELP_SECTIONS[0].id);
  const active = HELP_SECTIONS.find((s) => s.id === activeId) ?? HELP_SECTIONS[0];

  return (
    <div className="relative min-h-full overflow-hidden rounded-xl">
      <Aurora className="opacity-60" />

      <div className="relative space-y-8 py-4">
        {/* Hero */}
        <FadeIn>
          <div className="mx-auto max-w-3xl text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-primary/40 bg-primary/10">
              <HelpCircle className="h-7 w-7 text-primary" />
            </div>
            <p className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
              Scan · Signal · Simulate
            </p>
            <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              <GradientText>Yardım Merkezi</GradientText>
            </h1>
            <p className="mt-3 text-sm text-muted-foreground sm:text-base">
              Sistem nasıl çalışır, nasıl kullanılır? Tarama motorundan AI sinyallerine, simülasyondan
              canlı işleme kadar her şey burada.
            </p>
          </div>
        </FadeIn>

        {/* Section cards */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {HELP_SECTIONS.map((section, i) => {
            const Icon = section.icon;
            const isActive = section.id === activeId;
            return (
              <SpotlightCard
                key={section.id}
                className={cn(
                  "cursor-pointer rounded-2xl transition-all",
                  isActive &&
                    "border-primary/60 bg-primary/5 ring-1 ring-primary/60 shadow-[0_0_24px_-6px_hsl(var(--primary)/0.5)]",
                )}
              >
                <button
                  type="button"
                  onClick={() => setActiveId(section.id)}
                  className="flex h-full w-full flex-col items-start gap-2 p-4 text-left"
                >
                  <div className="flex w-full items-center justify-between">
                    <Icon
                      className={cn(
                        "h-5 w-5",
                        isActive ? "text-primary" : "text-muted-foreground",
                      )}
                    />
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <p className={cn("text-sm font-medium leading-snug", isActive && "text-primary")}>
                    {section.title}
                  </p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {section.summary}
                  </p>
                </button>
              </SpotlightCard>
            );
          })}
        </div>

        {/* Active section detail */}
        <FadeIn key={active.id} className="mx-auto max-w-5xl">
          <div className="overflow-hidden rounded-3xl border border-border bg-card/80 shadow-[0_24px_80px_-45px_rgba(255,255,255,0.25)] backdrop-blur">
            <div className="border-b border-border/60 px-6 py-5">
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground/70">
                ( Konu · {String(HELP_SECTIONS.indexOf(active) + 1).padStart(2, "0")} )
              </p>
              <div className="mt-3 flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10">
                  <active.icon className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h2 className="font-display text-xl font-semibold tracking-tight">
                    <GradientText>{active.title}</GradientText>
                  </h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">{active.summary}</p>
                </div>
              </div>
            </div>
            <div className="relative px-6 py-7 text-sm leading-7 text-muted-foreground">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_0%,hsl(var(--primary)/0.08),transparent_42%)]"
              />
              <div className="relative">
                {active.id === "planlar" ? <PlanComparison /> : active.body}
              </div>
            </div>
          </div>
        </FadeIn>

        <p className="pb-2 text-center text-[11px] text-muted-foreground">
          Bu içerik bilgilendirme amaçlıdır; finansal tavsiye değildir.
        </p>
      </div>
    </div>
  );
}

const HELP_PLANS = [
  {
    name: "Free",
    tag: "Keşfet",
    price: "$0",
    features: [
      ["15 dk gecikmeli veri", true],
      ["5 tarama filtresi", true],
      ["Simülasyon hesabı", true],
      ["AI sinyal motoru", false],
      ["Backtest", false],
    ] as const,
  },
  {
    name: "Basic",
    tag: "Aktif Trader",
    price: "$29",
    features: [
      ["Gerçek zamanlı veri", true],
      ["Sınırsız tarama", true],
      ["Tek tık işlem", true],
      ["Sınırlı backtest", true],
      ["AI sinyal motoru", false],
    ] as const,
  },
  {
    name: "Premium",
    tag: "Tam Güç",
    price: "$79",
    highlight: true,
    features: [
      ["Gerçek zamanlı veri", true],
      ["Sınırsız tarama + backtest", true],
      ["AI sinyal motoru", true],
      ["Tam otomatik işlem", true],
      ["Broker entegrasyonu", true],
    ] as const,
  },
] as const;

function PlanComparison() {
  return (
    <div>
      <div className="grid gap-4 md:grid-cols-3">
        {HELP_PLANS.map((plan, index) => (
          <SpotlightCard
            key={plan.name}
            className={cn(
              "rounded-2xl border bg-background/55",
              "highlight" in plan &&
                plan.highlight &&
                "border-primary/60 ring-1 ring-primary/30",
            )}
          >
            <div className="flex h-full flex-col p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                    ( {index + 1} ) · {plan.tag}
                  </p>
                  <h3 className="mt-3 font-display text-2xl font-semibold tracking-tight text-foreground">
                    {plan.name}
                  </h3>
                </div>
                {"highlight" in plan && plan.highlight ? (
                  <span className="rounded-full border border-primary/50 px-2 py-1 text-[9px] uppercase tracking-[0.2em] text-foreground">
                    En kapsamlı
                  </span>
                ) : null}
              </div>
              <div className="mt-5 flex items-end gap-1">
                <span className="font-display text-4xl font-semibold tracking-tight text-foreground">
                  {plan.price}
                </span>
                <span className="pb-1 text-xs text-muted-foreground">/ ay</span>
              </div>
              <div className="my-5 h-px bg-border/70" />
              <div className="flex-1 space-y-2.5">
                {plan.features.map(([label, included]) => (
                  <div key={label} className="flex items-center gap-2.5">
                    {included ? (
                      <Check className="h-3.5 w-3.5 text-foreground" />
                    ) : (
                      <Minus className="h-3.5 w-3.5 text-muted-foreground/40" />
                    )}
                    <span className={cn(!included && "text-muted-foreground/50")}>
                      {label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </SpotlightCard>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-background/40 px-5 py-4">
        <p className="max-w-2xl text-xs leading-6 text-muted-foreground">
          Gerçek zamanlı veri, bağlı veri sağlayıcısının planına bağlıdır. Tam otomatik
          işlem yalnızca onaylanmış risk limitleri ve aktif broker bağlantısıyla açılır.
        </p>
        <SpecularButton href="/settings/billing" className="px-5 py-2.5">
          Planları yönet
        </SpecularButton>
      </div>
    </div>
  );
}
