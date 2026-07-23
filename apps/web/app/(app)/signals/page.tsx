"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { SignalCard } from "@/components/signals/SignalCard";
import { EmptyState, ErrorState, LoadingBlock } from "@/components/shared/states";
import { Badge } from "@/components/ui/badge";
import { FadeIn } from "@/components/reactbits/FadeIn";
import { AnimatedList } from "@/components/reactbits/AnimatedList";
import { SpecularButton } from "@/components/reactbits/SpecularButton";
import { apiClient, networkErrorMessage } from "@/lib/api-client";
import { useExecutionStore } from "@/lib/store";
import { hasEntitlement } from "@/lib/entitlements";
import { connectSocket, onWsEvent } from "@/lib/ws-client";
import { cn } from "@/lib/utils";
import type { Signal, SignalSummary } from "@/lib/types";

export default function SignalsPage() {
  const planTier = useExecutionStore((s) => s.planTier);
  const { data: session } = useSession();
  const enabled = hasEntitlement(planTier, "ai_signals_enabled");
  const [signals, setSignals] = useState<Signal[]>([]);
  const [view, setView] = useState<"open" | "history">("open");
  const [summary, setSummary] = useState<SignalSummary | null>(null);
  const [tradeProfile, setTradeProfile] = useState<{
    broker: { broker: string; mode: "paper" | "live"; connectedAt: string } | null;
    maxRiskPerTrade: number | null;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh() {
    if (!enabled || !session?.accessToken) return;
    const token = session.accessToken;
    setLoading(true);
    setError(null);
    try {
      const [rows, nextSummary] = await Promise.all([
        apiClient.signals(token, view === "open" ? "open" : "all"),
        apiClient.signalSummary(token),
      ]);
      setSignals(view === "history" ? rows.filter((s) => s.status !== "open") : rows);
      setSummary(nextSummary);
      // Soft profile for order actions — don't block signal list on /me.
      void apiClient
        .me(token)
        .then((profile) => {
          setTradeProfile({
            broker: profile.broker,
            maxRiskPerTrade: profile.riskSettings?.maxRiskPerTrade ?? null,
          });
        })
        .catch(() => undefined);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Sinyaller yüklenemedi");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!enabled || !session?.accessToken) return;
    void refresh();
    const token = session.accessToken;
    connectSocket(token);
    const off = onWsEvent("signal:new", (signal) => {
      if (view === "open") setSignals((prev) => [signal, ...prev]);
    });
    const offResolved = onWsEvent("signal:resolved", (resolved) => {
      setSignals((prev) =>
        view === "open"
          ? prev.filter((signal) => signal.id !== resolved.id)
          : prev.map((signal) =>
              signal.id === resolved.id ? { ...signal, ...resolved } : signal,
            ),
      );
      void apiClient.signalSummary(token).then(setSummary);
    });
    return () => {
      off();
      offResolved();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh closes over view/token
  }, [enabled, session?.accessToken, view]);

  async function generateNow() {
    if (!session?.accessToken) return;
    setGenerating(true);
    setNotice(null);
    setError(null);
    try {
      const result = await apiClient.generateSignals(session.accessToken);
      setNotice(
        `${result.predictions ?? 0} tahmin · ${result.signalsCreated ?? 0} yeni açık sinyal`,
      );
      await refresh();
    } catch (err: unknown) {
      setError(networkErrorMessage(err, "Sinyal üretimi başarısız"));
    } finally {
      setGenerating(false);
    }
  }

  if (!enabled) {
    return (
      <div className="space-y-6">
        <div>
          <p className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
            ( AI Sinyalleri )
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">AI Signals</h1>
        </div>
        <div className="rounded-2xl border border-dashed border-border bg-card/60 backdrop-blur">
          <div className="space-y-4 px-6 py-10">
            <Badge variant="warning">Premium entitlement required</Badge>
            <p className="max-w-lg text-sm text-muted-foreground">
              The AI signal engine is disabled for Free/Basic. Backend returns 403 without
              <code className="mx-1 font-mono">ai_signals_enabled</code>.
            </p>
            <SpecularButton href="/settings/billing" className="px-6 py-2.5">
              Upgrade path
            </SpecularButton>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <FadeIn>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
              ( AI Sinyalleri )
            </p>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">AI Signals</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Overnight strategy selection feed. Outcomes are logged for accountability.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="success">Live API + WebSocket</Badge>
            <SpecularButton
              className="px-4 py-2 text-sm"
              disabled={generating}
              onClick={() => void generateNow()}
            >
              {generating ? "Üretiliyor…" : "Sinyal üret"}
            </SpecularButton>
          </div>
        </div>
      </FadeIn>

      <FadeIn delay={80}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Summary label="Open" value={summary?.open} />
          <Summary
            label="Hit rate"
            value={summary?.hitRate == null ? undefined : `${(summary.hitRate * 100).toFixed(1)}%`}
          />
          <Summary
            label="Average return"
            value={
              summary?.averageReturn == null
                ? undefined
                : `${(summary.averageReturn * 100).toFixed(2)}%`
            }
          />
        </div>
      </FadeIn>

      {notice ? (
        <FadeIn>
          <div className="rounded-2xl border border-border bg-card/70 px-5 py-3 text-sm text-muted-foreground">
            {notice}
          </div>
        </FadeIn>
      ) : null}

      <FadeIn delay={160}>
        <div className="space-y-4">
          <div className="inline-flex rounded-full border border-border bg-card/60 p-1 backdrop-blur">
            <ViewTab active={view === "open"} onClick={() => setView("open")}>
              Açık sinyaller
            </ViewTab>
            <ViewTab active={view === "history"} onClick={() => setView("history")}>
              Sonuç geçmişi
            </ViewTab>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-2xl border border-border bg-card/60 p-4">
              <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                Açık
              </p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Modelin ürettiği giriş, hedef ve stop seviyeleri henüz sonuçlanmamıştır.
                Sistem piyasa açıkken fiyat yolunu düzenli kontrol eder.
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-card/60 p-4">
              <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                Sonuç
              </p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Sinyal üretildikten sonraki gerçek bar verisinde (önce 5 dk, yoksa günlük)
                high hedefe veya low stopa değerse sonuç yazılır. Eski mumlar
                kullanılmaz; 48 saat içinde ikisi de olmazsa “Süresi doldu” olur.
              </p>
            </div>
          </div>

          {loading ? <LoadingBlock rows={4} /> : null}
          {error ? <ErrorState description={error} onRetry={() => setError(null)} /> : null}
          {!loading && !error && signals.length === 0 ? (
            <EmptyState
              title={view === "open" ? "Açık sinyal yok" : "Kapanmış sinyal yok"}
              description={
                view === "open"
                  ? "Model henüz yeni sinyal üretmedi. Geçmiş sonuçlar için Sonuç geçmişi’ne bakın veya Models’ten sinyal üretimini tetikleyin."
                  : "Kapanmış sinyaller hedef, stop veya süre dolduğunda burada listelenir."
              }
            />
          ) : null}
          <AnimatedList maxHeight={640} fade>
            <div className="grid gap-3 pb-6 md:grid-cols-2 xl:grid-cols-3">
              {signals.map((s) => (
                <SignalCard
                  key={s.id}
                  signal={s}
                  token={session?.accessToken}
                  broker={tradeProfile?.broker ?? null}
                  maxRiskPerTrade={tradeProfile?.maxRiskPerTrade ?? null}
                />
              ))}
            </div>
          </AnimatedList>
        </div>
      </FadeIn>
    </div>
  );
}

function ViewTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Summary({ label, value }: { label: string; value?: number | string }) {
  return (
    <div className="rounded-2xl border border-border bg-card/80 p-5 backdrop-blur">
      <p className="text-[11px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="mt-2 font-mono text-2xl font-semibold">{value ?? "—"}</p>
    </div>
  );
}
