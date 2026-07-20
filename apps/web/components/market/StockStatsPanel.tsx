"use client";

import { useEffect, useState } from "react";
import { SpotlightCard } from "@/components/reactbits/SpotlightCard";
import { SymbolWithLogo } from "@/components/shared/StockLogo";
import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiClient } from "@/lib/api-client";
import type { StockStats } from "@/lib/types";
import { formatCompact, formatCurrency, formatNumber } from "@/lib/utils";

function MicroLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{children}</p>
  );
}

function StatCell({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-mono text-sm font-medium tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function money(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatCurrency(value);
}

function compact(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatCompact(value);
}

function ratio(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatNumber(value, 2);
}

export function StockStatsPanel({
  symbol,
  token,
}: {
  symbol?: string | null;
  token?: string | null;
}) {
  const [stats, setStats] = useState<StockStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!symbol || !token) {
      setStats(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const requested = symbol.toUpperCase();
    setStats(null);
    setLoading(true);
    setError(null);
    void apiClient
      .getStockStats(token, requested)
      .then((row) => {
        if (cancelled) return;
        if (row.symbol.toUpperCase() !== requested) return;
        setStats(row);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStats(null);
        setError(err instanceof Error ? err.message : "İstatistikler yüklenemedi");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, token]);

  const displaySymbol = (stats?.symbol ?? symbol)?.toUpperCase() ?? null;

  if (!symbol) {
    return (
      <SpotlightCard className="rounded-2xl">
        <CardContent className="py-8 text-sm text-muted-foreground">
          İstatistikler için listeden veya grafikten bir hisse seçin.
        </CardContent>
      </SpotlightCard>
    );
  }

  return (
    <SpotlightCard className="rounded-2xl">
      <CardHeader className="pb-3">
        <MicroLabel>İstatistikler</MicroLabel>
        <CardTitle className="mt-1 flex items-center gap-2 text-base">
          <SymbolWithLogo symbol={displaySymbol ?? symbol} size="sm" />
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground">Yükleniyor…</p>
        ) : error && !stats ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : stats ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <StatCell label="Açılış" value={money(stats.open)} />
            <StatCell label="Önceki kapanış" value={money(stats.previousClose)} />
            <StatCell label="En yüksek" value={money(stats.high)} />
            <StatCell label="En düşük" value={money(stats.low)} />
            <StatCell label="52 hafta en yüksek" value={money(stats.week52High)} />
            <StatCell label="52 hafta en düşük" value={money(stats.week52Low)} />
            <StatCell label="Ortalama hacim" value={compact(stats.avgVolume)} />
            <StatCell label="Piyasa değeri" value={compact(stats.marketCap)} />
            <StatCell label="F/K" value={ratio(stats.peRatio)} />
            <StatCell label="PD/DD" value={ratio(stats.priceToBook)} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Veri yok.</p>
        )}
      </CardContent>
    </SpotlightCard>
  );
}
