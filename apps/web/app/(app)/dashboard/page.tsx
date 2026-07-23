"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { ScanResultsTable } from "@/components/scanner/ScanResultsTable";
import { SignalCard } from "@/components/signals/SignalCard";
import { LiveChart } from "@/components/charts/LiveChart";
import { StockStatsPanel } from "@/components/market/StockStatsPanel";
import { SpotlightCard } from "@/components/reactbits/SpotlightCard";
import { CountUp } from "@/components/reactbits/CountUp";
import { FadeIn } from "@/components/reactbits/FadeIn";
import { AnimatedList } from "@/components/reactbits/AnimatedList";
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { apiClient } from "@/lib/api-client";
import { StockLogo } from "@/components/shared/StockLogo";
import { DEMO_SCAN_ROWS, DEMO_SIM_ACCOUNT } from "@/lib/demo-data";
import { useExecutionStore } from "@/lib/store";
import { hasEntitlement } from "@/lib/entitlements";
import { formatCurrency, cn } from "@/lib/utils";
import type { ScanRow, Signal, SimulatedPosition, SimulationAccount } from "@/lib/types";

type Watchlist = { id: string; name: string; symbols: string[] };

function MicroLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{children}</p>
  );
}

export default function DashboardPage() {
  const { data: session } = useSession();
  const token = session?.accessToken;
  const planTier = useExecutionStore((s) => s.planTier);
  const aiEnabled = hasEntitlement(planTier, "ai_signals_enabled");
  const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

  const [rows, setRows] = useState<ScanRow[]>(demoMode ? DEMO_SCAN_ROWS : []);
  const [rowsLive, setRowsLive] = useState(false);
  const [scanLoading, setScanLoading] = useState(!demoMode);
  const [scanHasRun, setScanHasRun] = useState(demoMode);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [selected, setSelected] = useState<ScanRow | null>(
    demoMode ? DEMO_SCAN_ROWS[0] ?? null : null,
  );
  /** Chart / stats symbol — follows table selection and chart picker. */
  const [focusSymbol, setFocusSymbol] = useState<string | null>(
    demoMode ? DEMO_SCAN_ROWS[0]?.symbol ?? null : null,
  );
  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
  const [tradeProfile, setTradeProfile] = useState<{
    broker: { broker: string; mode: "paper" | "live"; connectedAt: string } | null;
    maxRiskPerTrade: number | null;
  } | null>(null);
  const [sim, setSim] = useState<SimulationAccount | null>(
    demoMode ? DEMO_SIM_ACCOUNT : null,
  );

  const loadSimulation = useCallback(async () => {
    if (!token) return;
    try {
      setSim(await apiClient.simulationAccount(token));
    } catch {
      if (demoMode) setSim(DEMO_SIM_ACCOUNT);
    }
  }, [token, demoMode]);

  // Fast market pulse first (always fills the table), then expand the user's
  // saved scan in the background. Strict filters like volume_ratio>3 often
  // match nothing in the liquid head — that used to leave "No scan run yet".
  useEffect(() => {
    if (!token || demoMode) {
      if (demoMode) {
        setRows(DEMO_SCAN_ROWS);
        setSelected(DEMO_SCAN_ROWS[0] ?? null);
        setFocusSymbol(DEMO_SCAN_ROWS[0]?.symbol ?? null);
        setScanLoading(false);
        setScanHasRun(true);
      }
      return;
    }
    let cancelled = false;
    const FAST_LIMIT = 160;
    const EXPAND_CHUNK = 160;

    function mergeRows(prev: ScanRow[], next: ScanRow[]) {
      const bySymbol = new Map(prev.map((r) => [r.symbol, r]));
      for (const row of next) bySymbol.set(row.symbol, row);
      return Array.from(bySymbol.values()).sort(
        (a, b) => b.volumeRatio - a.volumeRatio || a.symbol.localeCompare(b.symbol),
      );
    }

    function applyRows(next: ScanRow[], live: boolean) {
      if (cancelled || next.length === 0) return;
      setRows((prev) => (live ? mergeRows(prev, next) : next));
      setSelected((prev) => prev ?? next[0] ?? null);
      setFocusSymbol((prev) => prev ?? next[0]?.symbol ?? null);
      setRowsLive(live);
      setScanHasRun(true);
    }

    (async () => {
      setScanLoading(true);
      try {
        // 1) Instant pulse so the pane is never empty.
        const pulse = await apiClient.scanPulse(token, 40);
        if (cancelled) return;
        setScanHasRun(true);
        if (pulse.rows.length > 0) {
          applyRows(pulse.rows, true);
          setScanLoading(false);
        }

        // 2) User saved scan — progressive expand.
        const scans = await apiClient.listScans(token);
        if (cancelled || scans.length === 0) {
          setScanLoading(false);
          return;
        }
        const scanId = scans[0].id;

        const first = await apiClient.runScan(token, scanId, {
          limit: FAST_LIMIT,
          offset: 0,
          timeoutMs: 25_000,
        });
        if (cancelled) return;
        setScanHasRun(true);
        if (first.rows.length > 0) {
          applyRows(first.rows, true);
        }
        setScanLoading(false);

        let offset = first.nextOffset ?? (first.hasMore ? FAST_LIMIT : null);
        while (!cancelled && offset != null) {
          const batch = await apiClient.runScan(token, scanId, {
            limit: EXPAND_CHUNK,
            offset,
            timeoutMs: 30_000,
          });
          if (cancelled) return;
          if (batch.rows.length > 0) {
            applyRows(batch.rows, true);
          }
          offset = batch.nextOffset ?? null;
        }
      } catch {
        if (!cancelled) {
          setScanHasRun(true);
          setScanLoading(false);
        }
      }
    })();

    void apiClient
      .signals(token)
      .then((live) => {
        if (!cancelled) setSignals(live);
      })
      .catch(() => undefined);

    void apiClient
      .listWatchlists(token)
      .then((lists) => {
        if (!cancelled) setWatchlists(lists);
      })
      .catch(() => undefined);

    void apiClient
      .me(token)
      .then((profile) => {
        if (cancelled) return;
        setTradeProfile({
          broker: profile.broker,
          maxRiskPerTrade: profile.riskSettings?.maxRiskPerTrade ?? null,
        });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [token, demoMode]);

  useEffect(() => {
    void loadSimulation();
    const interval = window.setInterval(() => void loadSimulation(), 20_000);
    const refreshOnFocus = () => void loadSimulation();
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [loadSimulation]);

  return (
    <div className="space-y-5">
      <FadeIn>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <MicroLabel>( 1 ) Overview</MicroLabel>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">
              Dashboard
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Taramalar, canlı grafik ve sinyaller tek ekranda.
            </p>
          </div>
          <Badge
            variant={rowsLive ? "secondary" : "outline"}
            className="uppercase tracking-[0.15em]"
          >
            {rowsLive ? "Canlı tarama sonuçları" : "Örnek satırlar · grafik canlı"}
          </Badge>
        </div>
      </FadeIn>

      {/* Mobile read-only summary */}
      <div className="grid gap-3 lg:hidden">
        <FadeIn>
          <SimulationPanel account={sim} />
        </FadeIn>
        <FadeIn delay={100}>
          <SpotlightCard className="rounded-2xl">
            <CardHeader className="pb-2">
              <MicroLabel>Scanner</MicroLabel>
              <CardTitle className="text-base">Top scan hits</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {rows.length === 0 ? (
                <p className="text-xs text-muted-foreground">Henüz tarama sonucu yok.</p>
              ) : (
                rows.slice(0, 4).map((row) => (
                  <div
                    key={row.symbol}
                    className="flex items-center justify-between rounded-lg border border-border/70 px-3 py-2 font-mono text-sm transition-colors hover:border-primary/40"
                  >
                    <span>{row.symbol}</span>
                    <span className={row.changePercent >= 0 ? "text-success" : "text-destructive"}>
                      {row.changePercent.toFixed(2)}%
                    </span>
                  </div>
                ))
              )}
            </CardContent>
          </SpotlightCard>
        </FadeIn>
        <p className="text-xs text-muted-foreground">
          Editing scans, placing orders, and risk changes require desktop width.
        </p>
      </div>

      {/* Desktop three-pane layout */}
      <div className="hidden gap-4 lg:grid lg:grid-cols-[220px_minmax(0,1fr)_280px]">
        <FadeIn>
          <SpotlightCard className="h-fit rounded-2xl">
            <CardHeader>
              <MicroLabel>Lists</MicroLabel>
              <CardTitle className="text-base">Watchlists</CardTitle>
              <CardDescription>Saved scans / lists</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {watchlists.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Henüz watchlist yok. Scanner ile oluşturabilirsiniz.
                </p>
              ) : (
                watchlists.map((wl) => (
                  <div
                    key={wl.id}
                    className="rounded-xl border border-border/70 bg-gradient-to-br from-card to-secondary/15 p-3 transition-colors hover:border-primary/40"
                  >
                    <p className="text-sm font-medium">{wl.name}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {wl.symbols.map((symbol) => (
                        <span
                          key={symbol}
                          className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/70 py-0.5 pl-0.5 pr-2 text-[11px]"
                        >
                          <StockLogo symbol={symbol} size="sm" />
                          <span className="font-mono font-semibold">{symbol}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                ))
              )}
              <Link
                href="/scanner"
                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-full")}
              >
                Open scanner
              </Link>
            </CardContent>
          </SpotlightCard>
        </FadeIn>

        <FadeIn delay={100} className="space-y-4">
          <ScanResultsTable
            rows={rows}
            loading={scanLoading}
            hasRun={scanHasRun}
            selectedSymbol={selected?.symbol}
            onSelect={(row) => {
              setSelected(row);
              setFocusSymbol(row.symbol);
            }}
          />
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                Chart
              </span>
              {selected?.stale ? <Badge variant="warning">Stale quote cache</Badge> : null}
            </div>
            <LiveChart
              symbol={focusSymbol}
              height={280}
              onSymbolChange={setFocusSymbol}
            />
          </div>
        </FadeIn>

        <FadeIn delay={200} className="space-y-3">
          <StockStatsPanel key={focusSymbol ?? "none"} symbol={focusSymbol} token={token} />
          <SpotlightCard className="rounded-2xl">
            <CardHeader className="pb-2">
              <MicroLabel>Intelligence</MicroLabel>
              <CardTitle className="text-base">AI signals</CardTitle>
              <CardDescription>
                {aiEnabled ? "Premium feed" : "Requires Premium entitlement"}
              </CardDescription>
            </CardHeader>
          </SpotlightCard>
          {aiEnabled ? (
            <AnimatedList maxVisible={4} itemHeight={200}>
              <div className="space-y-3">
                {signals.map((s) => (
                  <SignalCard
                    key={s.id}
                    signal={s}
                    token={token}
                    broker={tradeProfile?.broker ?? null}
                    maxRiskPerTrade={tradeProfile?.maxRiskPerTrade ?? null}
                    showOrderAction={false}
                  />
                ))}
              </div>
            </AnimatedList>
          ) : (
            <SpotlightCard className="rounded-2xl border-dashed">
              <CardContent className="space-y-3 py-6">
                <p className="text-sm text-muted-foreground">
                  AI signal engine is locked on Free/Basic. Upgrade to Premium to unlock Holly-style
                  overnight strategy selection.
                </p>
                <Link href="/settings/billing" className={cn(buttonVariants({ size: "sm" }))}>
                  View billing
                </Link>
              </CardContent>
            </SpotlightCard>
          )}
          <SimulationPanel account={sim} />
        </FadeIn>
      </div>
    </div>
  );
}

function tradePnl(trade: SimulatedPosition) {
  if (Number.isFinite(trade.pnl)) return trade.pnl;
  const direction = trade.side === "buy" ? 1 : -1;
  return (trade.currentPrice - trade.entryPrice) * direction * trade.quantity;
}

function SimulationPanel({ account }: { account: SimulationAccount | null }) {
  const closedTrades = account?.closedTrades ?? [];
  const realizedPnl = closedTrades.reduce((sum, trade) => sum + tradePnl(trade), 0);
  const unrealizedPnl = (account?.openPositions ?? []).reduce(
    (sum, position) => sum + tradePnl(position),
    0,
  );
  const totalPnl = realizedPnl + unrealizedPnl;
  const initialValue = account ? Math.max(account.equity - totalPnl, 0) : 0;
  const totalPnlPercent = initialValue > 0 ? (totalPnl / initialValue) * 100 : 0;
  const wins = closedTrades.filter((trade) => tradePnl(trade) > 0).length;
  const winRate = closedTrades.length > 0 ? (wins / closedTrades.length) * 100 : null;
  const pnlTone = totalPnl >= 0 ? "text-success" : "text-destructive";

  return (
    <SpotlightCard className="rounded-2xl">
      <CardHeader className="pb-3">
        <MicroLabel>Paper trading</MicroLabel>
        <CardTitle className="text-base">Simülasyon</CardTitle>
        <CardDescription>Sanal portföyünüzün güncel özeti</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Güncel bakiye
            </p>
            <p className="mt-1 font-mono text-lg font-medium">
              {account ? (
                <CountUp end={account.balance} prefix="$" decimals={2} />
              ) : (
                "—"
              )}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Açık pozisyon
            </p>
            <p className="mt-1 font-mono text-lg font-medium">
              {account ? <CountUp end={account.openPositions.length} /> : "—"}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Toplam K/Z
            </p>
            <p className={cn("mt-1 font-mono text-lg font-medium", account ? pnlTone : undefined)}>
              {account ? (
                <>
                  <CountUp
                    end={Math.abs(totalPnl)}
                    prefix={totalPnl >= 0 ? "+$" : "-$"}
                    decimals={2}
                  />
                  <span className="ml-1 text-xs">({totalPnlPercent.toFixed(2)}%)</span>
                </>
              ) : (
                "—"
              )}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Kazanma oranı
            </p>
            <p className="mt-1 font-mono text-lg font-medium">
              {winRate == null ? "—" : <CountUp end={winRate} suffix="%" decimals={1} />}
            </p>
          </div>
        </div>

        <div>
          <p className="mb-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            Son kapanan işlemler
          </p>
          {closedTrades.length === 0 ? (
            <p className="text-xs text-muted-foreground">Henüz kapanan işlem yok.</p>
          ) : (
            <div className="space-y-1.5">
              {closedTrades.slice(0, 5).map((trade) => {
                const pnl = tradePnl(trade);
                return (
                  <div
                    key={trade.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border/70 px-2.5 py-1.5 text-xs transition-colors hover:border-primary/40"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-mono">{trade.symbol}</span>
                      <Badge variant="outline" className="shrink-0">
                        {trade.side === "buy" ? "Alış" : "Satış"}
                      </Badge>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 font-mono",
                        pnl >= 0 ? "text-success" : "text-destructive",
                      )}
                    >
                      {formatCurrency(pnl)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <Link
          href="/simulation"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "w-full")}
        >
          Tüm simülasyonu aç
        </Link>
      </CardContent>
    </SpotlightCard>
  );
}
