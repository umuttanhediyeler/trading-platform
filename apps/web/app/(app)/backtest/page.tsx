"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, LoadingBlock } from "@/components/shared/states";
import { FadeIn } from "@/components/reactbits/FadeIn";
import { SpotlightCard } from "@/components/reactbits/SpotlightCard";
import { SpecularButton } from "@/components/reactbits/SpecularButton";
import { apiClient, networkErrorMessage } from "@/lib/api-client";
import { useExecutionStore } from "@/lib/store";
import { hasEntitlement } from "@/lib/entitlements";
import { formatPercent, cn } from "@/lib/utils";
import type {
  BacktestMetrics,
  BacktestRun,
  BacktestStrategy,
  StrategyCategory,
} from "@/lib/types";

const CATEGORY_LABELS: Record<StrategyCategory, string> = {
  "trend-following": "Trend Takibi",
  "mean-reversion": "Ortalamaya Dönüş",
  breakout: "Kırılma",
};

const METRIC_HELP = {
  "Toplam getiri": "Başlangıç sermayesinden dönem sonuna kadar oluşan net yüzdesel değişim.",
  Sharpe: "Risk başına getiriyi ölçer; yüksek değer daha dengeli performansa işaret eder.",
  "Maksimum düşüş": "Sermaye eğrisinin bir zirveden sonraki en büyük kaybı.",
  "Kazanma oranı": "Kârla kapanan işlemlerin tamamlanan işlemlere oranı.",
  Beklenti: "İşlem başına ortalama kâr veya zarar.",
  "Kâr faktörü": "Toplam brüt kârın toplam brüt zarara oranı.",
  "İşlem sayısı": "Backtest boyunca tamamlanan pozisyonların sayısı.",
} as const;

export default function BacktestPage() {
  const planTier = useExecutionStore((s) => s.planTier);
  const { data: session } = useSession();
  const enabled = hasEntitlement(planTier, "backtest_enabled");
  const unlimited = hasEntitlement(planTier, "backtest_unlimited");
  const [symbol, setSymbol] = useState("NVDA");
  const [strategies, setStrategies] = useState<BacktestStrategy[]>([]);
  const [strategyId, setStrategyId] = useState("");
  const [params, setParams] = useState<Record<string, number | boolean>>({});
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BacktestMetrics | null>(null);
  const [history, setHistory] = useState<BacktestRun[]>([]);
  const [quota, setQuota] = useState<{
    limit: number | null;
    used: number;
    remaining: number | null;
    periodEnd: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !session?.accessToken) return;
    const token = session.accessToken;
    apiClient.backtestRuns(token).then(setHistory).catch(() => undefined);
    apiClient.backtestQuota(token).then(setQuota).catch(() => undefined);
    apiClient
      .backtestStrategies(token)
      .then((catalog) => {
        setStrategies(catalog);
        if (catalog.length > 0) {
          const first = catalog[0];
          setStrategyId(first.id);
          setParams(defaultParams(first));
        }
      })
      .catch((err) => {
        setError(networkErrorMessage(err, "Strateji kataloğu yüklenemedi"));
      })
      .finally(() => setCatalogLoading(false));
  }, [enabled, session?.accessToken]);

  if (!enabled) {
    return (
      <div className="space-y-6">
        <div>
          <p className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
            ( Strateji Testi )
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">Backtest</h1>
        </div>
        <div className="rounded-2xl border border-dashed border-border bg-card/60 backdrop-blur">
          <div className="space-y-4 px-6 py-10">
            <Badge variant="warning">Basic or Premium required</Badge>
            <p className="text-sm text-muted-foreground">
              OddsMaker-style parameter sweeps are locked on Free.
            </p>
            <SpecularButton href="/settings/billing" className="px-6 py-2.5">
              View plans
            </SpecularButton>
          </div>
        </div>
      </div>
    );
  }

  async function run() {
    if (!session?.accessToken) {
      setError("Oturum bulunamadı. Lütfen tekrar giriş yapın.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.runBacktest(session.accessToken, {
        symbol,
        strategyId,
        params,
      });
      setResult(response);
      setHistory(await apiClient.backtestRuns(session.accessToken));
    } catch (err) {
      setResult(null);
      setError(networkErrorMessage(err, "Backtest çalıştırılamadı"));
    } finally {
      apiClient.backtestQuota(session.accessToken).then(setQuota).catch(() => undefined);
      setLoading(false);
    }
  }

  const overfitting =
    result?.liveSharpe30d !== undefined &&
    Math.abs(result.sharpe - result.liveSharpe30d) > 1.0;
  const selectedStrategy = strategies.find((strategy) => strategy.id === strategyId);

  function selectStrategy(strategy: BacktestStrategy) {
    setStrategyId(strategy.id);
    setParams(defaultParams(strategy));
    setResult(null);
  }

  return (
    <div className="space-y-6">
      <FadeIn>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
              ( Strateji Testi )
            </p>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">Backtest</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Alpaca günlük verisiyle Python vectorbt motorunda gerçek backtest.
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge variant={unlimited ? "success" : "secondary"}>
              {quota?.limit === null || unlimited
                ? "Unlimited"
                : quota
                  ? `${quota.remaining} / ${quota.limit} runs remaining`
                  : "Loading quota…"}
            </Badge>
            {quota?.limit !== null && quota ? (
              <span className="text-xs text-muted-foreground">
                Resets {new Date(quota.periodEnd).toLocaleDateString("tr-TR")} · failed accepted
                runs count
              </span>
            ) : null}
          </div>
        </div>
      </FadeIn>

      <FadeIn delay={80}>
      <Card className="rounded-2xl bg-card/80 backdrop-blur">
        <CardHeader>
          <CardTitle className="text-base">Strateji seçimi</CardTitle>
          <CardDescription>
            Yaklaşımı piyasa koşuluna göre seçin, ardından parametreleri özelleştirin.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {catalogLoading ? <LoadingBlock rows={3} /> : null}
          {!catalogLoading
            ? (Object.keys(CATEGORY_LABELS) as StrategyCategory[]).map((category) => {
                const categoryStrategies = strategies.filter(
                  (strategy) => strategy.category === category,
                );
                if (categoryStrategies.length === 0) return null;
                return (
                  <section key={category} className="space-y-2">
                    <h2 className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
                      {CATEGORY_LABELS[category]}
                    </h2>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {categoryStrategies.map((strategy) => (
                        <SpotlightCard
                          key={strategy.id}
                          className={cn(
                            "rounded-xl",
                            strategy.id === strategyId &&
                              "border-primary/60 bg-primary/5 ring-1 ring-primary/60",
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => selectStrategy(strategy)}
                            aria-pressed={strategy.id === strategyId}
                            className="h-full w-full p-4 text-left"
                          >
                            <span
                              className={cn(
                                "font-medium",
                                strategy.id === strategyId && "text-primary",
                              )}
                            >
                              {strategy.name}
                            </span>
                            <span className="mt-2 block text-xs leading-5 text-muted-foreground">
                              {firstSentence(strategy.description)}
                            </span>
                          </button>
                        </SpotlightCard>
                      ))}
                    </div>
                  </section>
                );
              })
            : null}
        </CardContent>
      </Card>
      </FadeIn>

      {selectedStrategy ? (
        <FadeIn delay={140}>
        <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
          <Card className="rounded-2xl bg-card/80 backdrop-blur">
            <CardHeader>
              <CardTitle className="text-base">{selectedStrategy.name} parametreleri</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="backtest-symbol">Sembol</Label>
                <Input
                  id="backtest-symbol"
                  value={symbol}
                  onChange={(event) => setSymbol(event.target.value.toUpperCase())}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {selectedStrategy.params.map((parameter) =>
                  parameter.type === "boolean" ? (
                    <label
                      key={parameter.name}
                      className="flex items-center gap-3 rounded-xl border border-border p-3 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(params[parameter.name])}
                        onChange={(event) =>
                          setParams((current) => ({
                            ...current,
                            [parameter.name]: event.target.checked,
                          }))
                        }
                        className="h-4 w-4 accent-primary"
                      />
                      {parameter.label}
                    </label>
                  ) : (
                    <div key={parameter.name} className="space-y-2">
                      <Label htmlFor={`param-${parameter.name}`}>{parameter.label}</Label>
                      <Input
                        id={`param-${parameter.name}`}
                        type="number"
                        min={parameter.min}
                        max={parameter.max}
                        step={Number.isInteger(parameter.default) ? 1 : 0.1}
                        value={Number(params[parameter.name] ?? parameter.default)}
                        onChange={(event) =>
                          setParams((current) => ({
                            ...current,
                            [parameter.name]: Number(event.target.value),
                          }))
                        }
                      />
                    </div>
                  ),
                )}
              </div>
              <Button
                onClick={run}
                disabled={loading || !symbol.trim() || quota?.remaining === 0}
                className="w-full"
              >
                {loading
                  ? "Çalıştırılıyor…"
                  : quota?.remaining === 0
                    ? "Monthly quota reached"
                    : "Backtest çalıştır"}
              </Button>
            </CardContent>
          </Card>
          <Card className="rounded-2xl bg-muted/20 backdrop-blur">
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base">Strateji hakkında</CardTitle>
                <Badge variant="secondary">
                  {CATEGORY_LABELS[selectedStrategy.category]}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-6 text-muted-foreground">
                {selectedStrategy.description}
              </p>
            </CardContent>
          </Card>
        </div>
        </FadeIn>
      ) : null}

      {loading ? <LoadingBlock rows={4} /> : null}
      {error ? (
        <Card className="rounded-2xl border-destructive/50">
          <CardContent className="py-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : null}

      {!loading && !result ? (
        <EmptyState
          title="No backtest result yet"
          description="Run a backtest to populate return, Sharpe, drawdown, and expectancy."
        />
      ) : null}

      {result && !loading ? (
        <FadeIn>
        <div className="space-y-4">
          {overfitting ? (
            <Card className="rounded-2xl border-warning/50 bg-warning/5">
              <CardContent className="py-4 text-sm">
                Overfitting warning: backtest Sharpe ({result.sharpe.toFixed(2)}) diverges from
                last-30d live/sim Sharpe ({result.liveSharpe30d?.toFixed(2)}) by more than 1.0.
              </CardContent>
            </Card>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Toplam getiri" value={formatPercent(result.totalReturn)} />
            <Metric label="Sharpe" value={result.sharpe.toFixed(2)} />
            <Metric label="Maksimum düşüş" value={formatPercent(result.maxDrawdown)} />
            <Metric label="Kazanma oranı" value={formatPercent(result.winRate)} />
            <Metric label="Beklenti" value={result.expectancy.toFixed(2)} />
            <Metric label="Kâr faktörü" value={result.profitFactor.toFixed(2)} />
            <Metric label="İşlem sayısı" value={String(result.numTrades ?? 0)} />
          </div>
          <Card className="rounded-2xl bg-card/80 backdrop-blur">
            <CardHeader>
              <CardTitle className="text-base">Sermaye eğrisi</CardTitle>
              <CardDescription>Portföy değerinin backtest süresindeki değişimi.</CardDescription>
            </CardHeader>
            <CardContent>
              <EquityCurve points={result.equityCurve ?? []} />
            </CardContent>
          </Card>
          <Card className="rounded-2xl bg-muted/20 backdrop-blur">
            <CardHeader>
              <CardTitle className="text-sm">Metrik rehberi</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
              {Object.entries(METRIC_HELP).map(([label, help]) => (
                <p key={label}>
                  <span className="font-medium text-foreground">{label}:</span> {help}
                </p>
              ))}
            </CardContent>
          </Card>
        </div>
        </FadeIn>
      ) : null}

      <FadeIn delay={200}>
      <Card className="rounded-2xl bg-card/80 backdrop-blur">
        <CardHeader>
          <CardTitle className="text-base">Run history</CardTitle>
          <CardDescription>Son 50 backtest ve kalıcı çalışma durumu.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">Henüz kayıtlı backtest yok.</p>
          ) : (
            history.map((run) => (
              <div
                key={run.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card/60 p-3 text-sm transition-colors hover:border-primary/40"
              >
                <div>
                  <span className="font-mono font-medium">{run.symbol}</span>
                  <span className="ml-2 text-muted-foreground">{run.strategyId}</span>
                </div>
                <div className="flex items-center gap-3">
                  {run.metrics ? (
                    <span className="font-mono">
                      {formatPercent(run.metrics.totalReturn)}
                    </span>
                  ) : null}
                  <Badge
                    variant={
                      run.status === "completed"
                        ? "success"
                        : run.status === "failed"
                          ? "destructive"
                          : "secondary"
                    }
                  >
                    {run.status}
                  </Badge>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
      </FadeIn>
    </div>
  );
}

function Metric({ label, value }: { label: keyof typeof METRIC_HELP; value: string }) {
  return (
    <div
      title={METRIC_HELP[label]}
      className="rounded-2xl border border-border bg-card/80 p-5 backdrop-blur"
    >
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-muted-foreground">
        {label}
        <span
          aria-label={METRIC_HELP[label]}
          className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-border text-[10px] normal-case tracking-normal"
        >
          ?
        </span>
      </p>
      <p className="mt-2 font-mono text-2xl font-semibold">{value}</p>
    </div>
  );
}

function defaultParams(strategy: BacktestStrategy): Record<string, number | boolean> {
  return Object.fromEntries(
    strategy.params.map((parameter) => [parameter.name, parameter.default]),
  );
}

function firstSentence(description: string): string {
  const end = description.indexOf(".");
  return end === -1 ? description : description.slice(0, end + 1);
}

function EquityCurve({
  points,
}: {
  points: Array<{ ts: string; equity: number }>;
}) {
  if (points.length < 2) {
    return <p className="text-sm text-muted-foreground">Sermaye eğrisi verisi bulunamadı.</p>;
  }
  const values = points.map((point) => point.equity);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const path = points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * 100;
      const y = 38 - ((point.equity - min) / range) * 36;
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");

  return (
    <div className="space-y-2">
      <svg
        viewBox="0 0 100 40"
        role="img"
        aria-label="Backtest sermaye eğrisi"
        className="h-52 w-full overflow-visible"
        preserveAspectRatio="none"
      >
        <path d={path} fill="none" stroke="currentColor" strokeWidth="0.8" className="text-primary" />
      </svg>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{new Date(points[0].ts).toLocaleDateString("tr-TR")}</span>
        <span>{new Date(points[points.length - 1].ts).toLocaleDateString("tr-TR")}</span>
      </div>
    </div>
  );
}
