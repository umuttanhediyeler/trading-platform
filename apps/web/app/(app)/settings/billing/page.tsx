"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Check, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FadeIn } from "@/components/reactbits/FadeIn";
import { useExecutionStore } from "@/lib/store";
import { planLabel } from "@/lib/entitlements";
import { apiClient } from "@/lib/api-client";
import type { PlanTier } from "@/lib/types";

interface PlanCard {
  tier: PlanTier;
  tag: string;
  price: string;
  blurb: string;
  cta: string;
  features: Array<{ label: string; included: boolean; note?: string }>;
}

const PLANS: PlanCard[] = [
  {
    tier: "free",
    tag: "Keşfet",
    price: "$0",
    blurb: "Kayıt sonrası varsayılan plan. Gecikmeli veri ve simülasyonla platformu tanı.",
    cta: "Varsayılan plan",
    features: [
      { label: "15 dk gecikmeli veri", included: true },
      { label: "5 tarama filtresi", included: true },
      { label: "Simülasyon hesabı", included: true },
      { label: "AI sinyal motoru", included: false },
      { label: "Backtest", included: false },
      { label: "Broker entegrasyonu", included: false },
    ],
  },
  {
    tier: "basic",
    tag: "Aktif Trader",
    price: "$29",
    blurb: "Sınırsız filtre, tek tık işlem ve broker bağlantısıyla aktif kullanım.",
    cta: "Basic'e geç",
    features: [
      { label: "Gerçek zamanlı veri", included: true, note: "*" },
      { label: "Sınırsız tarama filtresi", included: true },
      { label: "Simülasyon hesabı", included: true },
      { label: "Tek tıkla işlem", included: true },
      { label: "Sınırlı backtest", included: true },
      { label: "AI sinyal motoru", included: false },
    ],
  },
  {
    tier: "premium",
    tag: "Tam Güç",
    price: "$79",
    blurb: "AI sinyalleri, sınırsız backtest ve risk onaylı tam otomatik işlem.",
    cta: "Premium'a geç",
    features: [
      { label: "Gerçek zamanlı veri", included: true, note: "*" },
      { label: "Sınırsız tarama + backtest", included: true },
      { label: "AI sinyal motoru", included: true },
      { label: "Tam otomatik işlem", included: true, note: "risk onaylı" },
      { label: "Broker entegrasyonu", included: true },
      { label: "Öncelikli destek", included: true },
    ],
  },
];

const PLAN_STATUS_LABELS: Record<string, string> = {
  active: "Aktif",
  trialing: "Deneme süresi",
  past_due: "Ödeme gecikti",
  canceled: "İptal edildi",
};

export default function BillingPage() {
  const billingEnabled = process.env.NEXT_PUBLIC_BILLING_ENABLED === "true";
  const { data: session } = useSession();
  const token = session?.accessToken;
  const planTier = useExecutionStore((s) => s.planTier);
  const [planStatus, setPlanStatus] = useState<string | null>(null);
  const [periodEnd, setPeriodEnd] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const me = await apiClient.me(token);
        if (cancelled) return;
        setPlanStatus(me.plan.status);
        setPeriodEnd(me.plan.currentPeriodEnd);
      } catch {
        // Plan details stay hidden; the cards still render from the store tier.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function checkout(tier: "basic" | "premium") {
    if (!billingEnabled) {
      setMessage(
        "Online ödeme geçici olarak kapalı. Mevcut planınız ve erişimleriniz değişmez.",
      );
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      if (!token) {
        setMessage("Oturum gerekli — tekrar giriş yapın.");
        return;
      }
      const { url } = await apiClient.checkout(token, tier);
      window.location.href = url;
      return;
    } catch {
      setMessage("Ödeme sayfası açılamadı — API veya Stripe erişilemiyor.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <FadeIn>
        <div>
          <p className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
            ( Plan &amp; Faturalama )
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">
            Planını Seç
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Planın; veri hızını, AI sinyallerini ve otomasyon yetkilerini belirler. İstediğin
            zaman iptal edebilirsin.
          </p>
        </div>
      </FadeIn>

      <FadeIn delay={60}>
        <div className="rounded-2xl border border-border bg-card/80 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-5">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <div>
                <p className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
                  Mevcut plan
                </p>
                <p className="mt-1 font-display text-lg font-semibold tracking-tight">
                  {planLabel(planTier)}
                </p>
              </div>
              {planStatus ? (
                <div>
                  <p className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
                    Durum
                  </p>
                  <p className="mt-1 text-sm">
                    {PLAN_STATUS_LABELS[planStatus] ?? planStatus}
                  </p>
                </div>
              ) : null}
              {periodEnd ? (
                <div>
                  <p className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
                    Dönem sonu
                  </p>
                  <p className="mt-1 font-mono text-sm">
                    {new Date(periodEnd).toLocaleDateString("tr-TR", { dateStyle: "medium" })}
                  </p>
                </div>
              ) : null}
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={busy || !billingEnabled}
              onClick={async () => {
                if (!token) {
                  setMessage("Müşteri portalı için oturum gerekli.");
                  return;
                }
                try {
                  const { url } = await apiClient.portal(token);
                  window.location.href = url;
                } catch {
                  setMessage("Müşteri portalı şu an erişilemiyor.");
                }
              }}
            >
              {billingEnabled ? "Faturalama portalını aç" : "Online ödeme kapalı"}
            </Button>
          </div>
        </div>
      </FadeIn>

      <FadeIn delay={120}>
        <div className="grid gap-4 md:grid-cols-3">
          {PLANS.map((plan) => {
            const isCurrent = planTier === plan.tier;
            const highlight = isCurrent || (planTier === "free" && plan.tier === "premium");
            return (
              <div
                key={plan.tier}
                className={
                  highlight
                    ? "relative h-full rounded-2xl bg-gradient-to-b from-primary/60 via-border to-border p-px"
                    : "relative h-full rounded-2xl border border-border"
                }
              >
                <div className="flex h-full flex-col rounded-2xl bg-card/90 p-6 backdrop-blur">
                  {isCurrent ? (
                    <span className="absolute -top-3 right-5 rounded-full bg-primary px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-primary-foreground">
                      Mevcut Plan
                    </span>
                  ) : planTier === "free" && plan.tier === "premium" ? (
                    <span className="absolute -top-3 right-5 rounded-full border border-primary/40 bg-terminal px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-primary">
                      Önerilen
                    </span>
                  ) : null}
                  <p className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
                    {plan.tag}
                  </p>
                  <div className="mt-3 flex items-baseline gap-2">
                    <span className="font-display text-3xl font-semibold tracking-tight">
                      {plan.price}
                    </span>
                    <span className="text-xs text-muted-foreground">/ ay</span>
                  </div>
                  <p className="mt-1 font-display text-base font-medium">
                    {planLabel(plan.tier)}
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    {plan.blurb}
                  </p>
                  <ul className="mt-5 flex-1 space-y-2.5 text-sm">
                    {plan.features.map((f) => (
                      <li key={f.label} className="flex items-start gap-2.5">
                        {f.included ? (
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                        ) : (
                          <Minus
                            className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/40"
                            aria-hidden
                          />
                        )}
                        <span
                          className={f.included ? "text-foreground" : "text-muted-foreground/60"}
                        >
                          {f.label}
                          {f.note ? (
                            <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">
                              {f.note}
                            </span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-6">
                    {plan.tier === "free" ? (
                      <Button variant="outline" disabled className="w-full">
                        {isCurrent ? "Mevcut plan" : "Varsayılan plan"}
                      </Button>
                    ) : (
                      <Button
                        className="w-full"
                        variant={isCurrent ? "outline" : "default"}
                        disabled={busy || isCurrent || !billingEnabled}
                        onClick={() => checkout(plan.tier as "basic" | "premium")}
                      >
                        {isCurrent
                          ? "Mevcut plan"
                          : billingEnabled
                            ? plan.cta
                            : "Yakında"}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </FadeIn>

      <FadeIn delay={160}>
        <div className="space-y-1 text-xs text-muted-foreground">
          {!billingEnabled ? (
            <p>
              Online ödeme ilk paper-trading sürümünde güvenli şekilde kapalıdır.
              Geçerli Stripe anahtarları doğrulandıktan sonra açılacaktır.
            </p>
          ) : null}
          <p>* Gerçek zamanlı veri, veri sağlayıcı aboneliğinize bağlıdır.</p>
        </div>
      </FadeIn>

      {message ? <p className="text-sm text-destructive">{message}</p> : null}
    </div>
  );
}
