"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import {
  ArrowUpRight,
  Landmark,
  LogOut,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FadeIn } from "@/components/reactbits/FadeIn";
import { SpotlightCard } from "@/components/reactbits/SpotlightCard";
import { SpecularButton } from "@/components/reactbits/SpecularButton";
import { planLabel } from "@/lib/entitlements";
import { apiClient } from "@/lib/api-client";
import { useExecutionStore } from "@/lib/store";
import type { PlanTier } from "@/lib/types";

const PLAN_STATUS_LABELS: Record<string, string> = {
  active: "Aktif",
  trialing: "Deneme süresi",
  past_due: "Ödeme gecikti",
  canceled: "İptal edildi",
};

const QUICK_LINKS = [
  {
    href: "/settings/billing",
    label: "Plan & Faturalama",
    body: "Planını yükselt, faturalama portalını aç.",
    icon: Wallet,
  },
  {
    href: "/settings/risk",
    label: "Risk Kontrolleri",
    body: "Günlük limitler, işlem başına risk, kill switch.",
    icon: ShieldCheck,
  },
  {
    href: "/settings/broker",
    label: "Broker Bağlantısı",
    body: "Aracı kurumunu bağla, otomatik işleme geç.",
    icon: Landmark,
  },
];

export default function AccountSettingsPage() {
  const { data: session } = useSession();
  const token = session?.accessToken;
  const storeTier = useExecutionStore((s) => s.planTier);
  const executionMode = useExecutionStore((s) => s.executionMode);
  const killSwitchActive = useExecutionStore((s) => s.killSwitchActive);

  const [email, setEmail] = useState(session?.user?.email ?? "");
  const [tier, setTier] = useState<PlanTier>(storeTier);
  const [planStatus, setPlanStatus] = useState<string | null>(null);
  const [periodEnd, setPeriodEnd] = useState<string | null>(null);
  const [broker, setBroker] = useState<{
    broker: string;
    mode: string;
    connectedAt: string;
  } | null>(null);
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const me = await apiClient.me(token);
        if (cancelled) return;
        setEmail(me.email);
        setTier((me.plan?.tier as PlanTier) ?? storeTier);
        setPlanStatus(me.plan?.status ?? null);
        setPeriodEnd(me.plan?.currentPeriodEnd ?? null);
        setBroker(me.broker ?? null);
        setCreatedAt(me.createdAt ?? null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Profil yüklenemedi");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, storeTier]);

  const modeLabel =
    executionMode === "full_auto"
      ? "Tam otomatik"
      : executionMode === "one_click"
        ? "Tek tık"
        : "Manuel";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <FadeIn>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
              ( Hesap )
            </p>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">
              Hesap Ayarları
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Profil özeti, plan durumu ve hesap yönetim kısayolları.
            </p>
          </div>
          <Badge className="uppercase tracking-[0.2em]">{planLabel(tier)}</Badge>
        </div>
      </FadeIn>

      {error ? (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/10 px-5 py-4 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <FadeIn delay={60}>
        <div className="rounded-2xl border border-border bg-card/80 backdrop-blur">
          <div className="grid gap-6 px-6 py-6 sm:grid-cols-2 lg:grid-cols-4">
            <Meta
              label="E-posta"
              value={email || "—"}
              mono={false}
            />
            <Meta
              label="Plan durumu"
              value={
                planStatus
                  ? (PLAN_STATUS_LABELS[planStatus] ?? planStatus)
                  : "—"
              }
            />
            <Meta
              label="Dönem sonu"
              value={
                periodEnd
                  ? new Date(periodEnd).toLocaleDateString("tr-TR", {
                      dateStyle: "medium",
                    })
                  : "—"
              }
            />
            <Meta
              label="Üyelik"
              value={
                createdAt
                  ? new Date(createdAt).toLocaleDateString("tr-TR", {
                      dateStyle: "medium",
                    })
                  : "—"
              }
            />
          </div>
        </div>
      </FadeIn>

      <FadeIn delay={100}>
        <div className="grid gap-4 md:grid-cols-3">
          <SpotlightCard className="rounded-2xl border border-border bg-card/70 p-5">
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground/70">
              ( 1 )
            </p>
            <p className="mt-2 font-display text-lg font-semibold tracking-tight">
              İşlem modu
            </p>
            <p className="mt-1 text-2xl font-semibold tracking-tight">{modeLabel}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Risk sayfasından değiştirilebilir.
            </p>
          </SpotlightCard>

          <SpotlightCard className="rounded-2xl border border-border bg-card/70 p-5">
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground/70">
              ( 2 )
            </p>
            <p className="mt-2 font-display text-lg font-semibold tracking-tight">
              Kill switch
            </p>
            <p className="mt-1 text-2xl font-semibold tracking-tight">
              {killSwitchActive ? "Aktif" : "Kapalı"}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Acil durdurma üst barda her ekranda.
            </p>
          </SpotlightCard>

          <SpotlightCard className="rounded-2xl border border-border bg-card/70 p-5">
            <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground/70">
              ( 3 )
            </p>
            <p className="mt-2 font-display text-lg font-semibold tracking-tight">
              Broker
            </p>
            <p className="mt-1 text-2xl font-semibold tracking-tight capitalize">
              {broker ? broker.broker : "Bağlı değil"}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {broker
                ? `${broker.mode} · ${new Date(broker.connectedAt).toLocaleDateString("tr-TR")}`
                : "Otomatik işlem için kurum bağla."}
            </p>
          </SpotlightCard>
        </div>
      </FadeIn>

      <FadeIn delay={140}>
        <div>
          <p className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
            ( Kısayollar )
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {QUICK_LINKS.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="group rounded-2xl border border-border bg-card/70 p-5 transition-colors hover:border-primary/40"
                >
                  <div className="flex items-start justify-between gap-3">
                    <Icon className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground" />
                    <ArrowUpRight className="h-4 w-4 text-muted-foreground/50 transition-colors group-hover:text-foreground" />
                  </div>
                  <p className="mt-4 font-display text-base font-semibold tracking-tight">
                    {item.label}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">{item.body}</p>
                </Link>
              );
            })}
          </div>
        </div>
      </FadeIn>

      <FadeIn delay={180}>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card/60 px-6 py-5">
          <div>
            <p className="font-display text-lg font-semibold tracking-tight">
              Oturumu kapat
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Bu cihazdaki oturumu sonlandırır. Verileriniz silinmez.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <SpecularButton href="/help" className="px-5 py-2.5 text-sm">
              Yardım
            </SpecularButton>
            <Button
              variant="destructive"
              onClick={() => void signOut({ callbackUrl: "/" })}
            >
              <LogOut className="mr-2 h-4 w-4" />
              Çıkış Yap
            </Button>
          </div>
        </div>
      </FadeIn>
    </div>
  );
}

function Meta({
  label,
  value,
  mono = true,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
        {label}
      </p>
      <p
        className={`mt-1.5 truncate text-sm ${mono ? "font-mono" : "font-medium"}`}
      >
        {value}
      </p>
    </div>
  );
}
