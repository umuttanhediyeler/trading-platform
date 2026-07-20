"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SpotlightCard } from "@/components/reactbits/SpotlightCard";
import { CountUp } from "@/components/reactbits/CountUp";
import { FadeIn } from "@/components/reactbits/FadeIn";
import { AnimatedList } from "@/components/reactbits/AnimatedList";
import { SymbolWithLogo } from "@/components/shared/StockLogo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState, LoadingBlock } from "@/components/shared/states";
import { apiClient } from "@/lib/api-client";
import { formatCurrency, formatNumber, cn } from "@/lib/utils";
import type { SimulatedPosition, SimulationAccount } from "@/lib/types";

const STOP_PCT = 0.03;
const TARGET_PCT = 0.06;
const DEFAULT_RISK_PCT = 1;

function MicroLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{children}</p>
  );
}

function SourceBadge({ source }: { source: SimulatedPosition["source"] }) {
  if (source === "ai_signal") {
    return (
      <Badge variant="default" className="whitespace-nowrap">
        AI sinyali
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="whitespace-nowrap">
      Manuel
    </Badge>
  );
}

function sideLabel(side: string) {
  return side === "buy" ? "Alış" : side === "sell" ? "Satış" : side;
}

function roundPrice(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value >= 100) return Math.round(value * 100) / 100;
  if (value >= 1) return Math.round(value * 1000) / 1000;
  return Math.round(value * 10000) / 10000;
}

function defaultStopTarget(price: number, side: "buy" | "sell") {
  if (side === "buy") {
    return {
      stop: roundPrice(price * (1 - STOP_PCT)),
      target: roundPrice(price * (1 + TARGET_PCT)),
    };
  }
  return {
    stop: roundPrice(price * (1 + STOP_PCT)),
    target: roundPrice(price * (1 - TARGET_PCT)),
  };
}

function cumulativePnlSeries(closed: SimulatedPosition[]) {
  const chronological = [...closed].reverse();
  let running = 0;
  return chronological.map((trade) => {
    running += trade.pnl;
    return running;
  });
}

export default function SimulationPage() {
  const { data: session } = useSession();
  const [account, setAccount] = useState<SimulationAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [symbol, setSymbol] = useState("AAPL");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [quantity, setQuantity] = useState(1);
  const [stopPrice, setStopPrice] = useState(0);
  const [targetPrice, setTargetPrice] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [quotePrice, setQuotePrice] = useState<number | null>(null);
  const [quoteStale, setQuoteStale] = useState(false);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [riskPct, setRiskPct] = useState(DEFAULT_RISK_PCT);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [confirmCloseId, setConfirmCloseId] = useState<string | null>(null);
  const stopTouched = useRef(false);
  const targetTouched = useRef(false);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!session?.accessToken) return;
      if (!opts?.silent) setLoading(true);
      setError(null);
      try {
        setAccount(await apiClient.simulationAccount(session.accessToken));
      } catch (err) {
        const raw = err instanceof Error ? err.message : "Simülasyon hesabı yüklenemedi";
        setError(raw === "Failed to fetch" ? "API’ye bağlanılamadı — sunucu ayakta mı?" : raw);
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [session?.accessToken],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!session?.accessToken) return;
    const tick = () => {
      if (document.visibilityState === "visible") void load({ silent: true });
    };
    const id = window.setInterval(tick, 15_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [load, session?.accessToken]);

  useEffect(() => {
    if (!session?.accessToken) return;
    const trimmed = symbol.trim().toUpperCase();
    if (trimmed.length < 1) {
      setQuotePrice(null);
      setQuoteError(null);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setQuoteLoading(true);
      setQuoteError(null);
      try {
        const quote = await apiClient.getQuote(session.accessToken!, trimmed);
        if (cancelled) return;
        setQuotePrice(quote.price);
        setQuoteStale(Boolean(quote.stale));
        if (!stopTouched.current || !targetTouched.current) {
          const defaults = defaultStopTarget(quote.price, side);
          if (!stopTouched.current) setStopPrice(defaults.stop);
          if (!targetTouched.current) setTargetPrice(defaults.target);
        }
      } catch (err) {
        if (cancelled) return;
        setQuotePrice(null);
        setQuoteError(err instanceof Error ? err.message : "Fiyat alınamadı");
      } finally {
        if (!cancelled) setQuoteLoading(false);
      }
    }, 400);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [symbol, side, session?.accessToken]);

  useEffect(() => {
    if (quotePrice == null) return;
    if (stopTouched.current && targetTouched.current) return;
    const defaults = defaultStopTarget(quotePrice, side);
    if (!stopTouched.current) setStopPrice(defaults.stop);
    if (!targetTouched.current) setTargetPrice(defaults.target);
  }, [side, quotePrice]);

  const estimatedCost = useMemo(() => {
    if (quotePrice == null || quantity < 1) return null;
    return quotePrice * quantity;
  }, [quotePrice, quantity]);

  const balancePct = useMemo(() => {
    if (!account || estimatedCost == null || account.balance <= 0) return null;
    return (estimatedCost / account.balance) * 100;
  }, [account, estimatedCost]);

  const suggestedQty = useMemo(() => {
    if (!account || quotePrice == null || stopPrice <= 0) return null;
    const stopDistance = Math.abs(quotePrice - stopPrice);
    if (stopDistance <= 0) return null;
    const riskAmount = account.equity * (riskPct / 100);
    const qty = Math.floor(riskAmount / stopDistance);
    return qty >= 1 ? qty : null;
  }, [account, quotePrice, stopPrice, riskPct]);

  const validationMessages = useMemo(() => {
    const messages: string[] = [];
    if (!symbol.trim()) messages.push("Sembol gerekli.");
    if (!Number.isFinite(quantity) || quantity < 1) messages.push("Adet en az 1 olmalı.");
    if (quotePrice == null) {
      if (!quoteLoading) messages.push("Geçerli bir fiyat bulunamadı.");
    } else {
      if (estimatedCost != null && account && estimatedCost > account.balance) {
        messages.push(
          `Yetersiz bakiye — tahmini maliyet ${formatCurrency(estimatedCost)}, bakiye ${formatCurrency(account.balance)}.`,
        );
      }
      if (side === "buy") {
        if (stopPrice >= quotePrice) messages.push("Alışta stop fiyatın altında olmalı.");
        if (targetPrice <= quotePrice) messages.push("Alışta hedef fiyatın üstünde olmalı.");
      } else {
        if (stopPrice <= quotePrice) messages.push("Satışta stop fiyatın üstünde olmalı.");
        if (targetPrice >= quotePrice) messages.push("Satışta hedef fiyatın altında olmalı.");
      }
    }
    if (stopPrice <= 0 || targetPrice <= 0) messages.push("Stop ve hedef pozitif olmalı.");
    return messages;
  }, [
    symbol,
    quantity,
    quotePrice,
    quoteLoading,
    estimatedCost,
    account,
    side,
    stopPrice,
    targetPrice,
  ]);

  const canSubmit = validationMessages.length === 0 && !submitting && !quoteLoading;

  const pnlSparkline = useMemo(
    () => (account ? cumulativePnlSeries(account.closedTrades) : []),
    [account],
  );

  async function placeOrder() {
    if (!session?.accessToken || !canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.placeSimOrder(session.accessToken, {
        symbol: symbol.trim().toUpperCase(),
        side,
        quantity,
        stopPrice,
        targetPrice,
      });
      stopTouched.current = false;
      targetTouched.current = false;
      await load({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Emir açılamadı");
    } finally {
      setSubmitting(false);
    }
  }

  async function closePosition(position: SimulatedPosition) {
    if (!session?.accessToken) return;
    setClosingId(position.id);
    setError(null);
    try {
      let exitPrice = position.currentPrice;
      try {
        const quote = await apiClient.getQuote(session.accessToken, position.symbol);
        exitPrice = quote.price;
      } catch {
        // fall back to mark price from account snapshot
      }
      await apiClient.closeSimOrder(session.accessToken, position.id, exitPrice);
      setConfirmCloseId(null);
      await load({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pozisyon kapatılamadı");
    } finally {
      setClosingId(null);
    }
  }

  if (loading && !account) {
    return (
      <div className="space-y-4">
        <div>
          <MicroLabel>( 1 ) Paper trading</MicroLabel>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">Simülasyon</h1>
        </div>
        <LoadingBlock rows={6} />
      </div>
    );
  }

  if (!account) {
    return (
      <div className="space-y-4">
        <div>
          <MicroLabel>( 1 ) Paper trading</MicroLabel>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">Simülasyon</h1>
        </div>
        <p className="text-sm text-destructive">{error ?? "Hesap bulunamadı"}</p>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          Yeniden dene
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <FadeIn>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <MicroLabel>( 1 ) Paper trading</MicroLabel>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">
              Simülasyon
            </h1>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              Gecikmeli / önbellekli piyasa fiyatıyla sanal emir açın. Gerçek para
              kullanılmaz; AI sinyalleri buraya &quot;AI sinyali&quot; kaynağıyla düşer.
            </p>
          </div>
          <Badge variant="outline" className="uppercase tracking-[0.15em]">
            Başlangıç $100k
          </Badge>
        </div>
      </FadeIn>

      {error ? (
        <Card className="rounded-2xl border-destructive/50">
          <CardContent className="py-3 text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : null}

      <FadeIn delay={80}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Bakiye" value={account.balance} />
          <Stat label="Özkaynak" value={account.equity} />
          <Stat
            label="Günlük K/Z"
            value={account.dayPnl}
            signed
            tone={account.dayPnl >= 0 ? "success" : "destructive"}
          />
          <SpotlightCard className="rounded-2xl">
            <CardContent className="py-5">
              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                Kümülatif K/Z
              </p>
              {pnlSparkline.length > 1 ? (
                <div className="mt-3">
                  <PnlSparkline values={pnlSparkline} />
                  <p
                    className={cn(
                      "mt-2 font-mono text-sm",
                      pnlSparkline[pnlSparkline.length - 1] >= 0
                        ? "text-success"
                        : "text-destructive",
                    )}
                  >
                    {formatCurrency(pnlSparkline[pnlSparkline.length - 1])}
                  </p>
                </div>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
                  Kapalı işlem yok — eğri burada birikir.
                </p>
              )}
            </CardContent>
          </SpotlightCard>
        </div>
      </FadeIn>

      <FadeIn delay={140}>
        <SpotlightCard className="rounded-2xl">
          <CardHeader>
            <MicroLabel>( 2 ) Emir</MicroLabel>
            <CardTitle className="text-base">Yeni sanal emir</CardTitle>
            <CardDescription>
              Canlı fiyat (gecikmeli feed) ile stop/hedef önerilir; sunucu nihai kaynağıdır.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
              <div className="space-y-1">
                <Label>Sembol</Label>
                <Input
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                  className="font-mono uppercase"
                />
                <p className="text-[11px] text-muted-foreground">
                  {quoteLoading
                    ? "Fiyat yükleniyor…"
                    : quotePrice != null
                      ? `Fiyat: $${formatNumber(quotePrice)}${quoteStale ? " · gecikmeli" : ""}`
                      : quoteError
                        ? quoteError
                        : "—"}
                </p>
              </div>
              <div className="space-y-1">
                <Label>Yön</Label>
                <Select
                  value={side}
                  onChange={(e) => {
                    stopTouched.current = false;
                    targetTouched.current = false;
                    setSide(e.target.value as "buy" | "sell");
                  }}
                >
                  <option value="buy">Alış</option>
                  <option value="sell">Satış</option>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Adet</Label>
                <Input
                  type="number"
                  min={1}
                  value={quantity}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                  className="font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label>
                  Stop ({side === "buy" ? "−" : "+"}%{Math.round(STOP_PCT * 100)} öneri)
                </Label>
                <Input
                  type="number"
                  step="0.01"
                  value={stopPrice || ""}
                  onChange={(e) => {
                    stopTouched.current = true;
                    setStopPrice(Number(e.target.value));
                  }}
                  className="font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label>
                  Hedef ({side === "buy" ? "+" : "−"}%{Math.round(TARGET_PCT * 100)} öneri)
                </Label>
                <Input
                  type="number"
                  step="0.01"
                  value={targetPrice || ""}
                  onChange={(e) => {
                    targetTouched.current = true;
                    setTargetPrice(Number(e.target.value));
                  }}
                  className="font-mono"
                />
              </div>
              <div className="flex items-end">
                <Button className="w-full" disabled={!canSubmit} onClick={() => void placeOrder()}>
                  {submitting ? "Açılıyor…" : "Emir aç"}
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-secondary/20 px-3 py-2.5 text-sm">
              <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Özet
              </span>
              <span className="font-mono text-muted-foreground">
                Maliyet:{" "}
                <span className="text-foreground">
                  {estimatedCost != null ? formatCurrency(estimatedCost) : "—"}
                </span>
                {balancePct != null ? (
                  <span className="ml-2">({formatNumber(balancePct, 1)}% bakiye)</span>
                ) : null}
              </span>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <Label className="text-xs text-muted-foreground">Risk %/işlem</Label>
                <Input
                  type="number"
                  min={0.25}
                  max={10}
                  step={0.25}
                  value={riskPct}
                  onChange={(e) => setRiskPct(Number(e.target.value))}
                  className="h-8 w-20 font-mono"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={suggestedQty == null}
                  onClick={() => {
                    if (suggestedQty != null) setQuantity(suggestedQty);
                  }}
                >
                  Öneri{suggestedQty != null ? `: ${suggestedQty}` : ""}
                </Button>
              </div>
            </div>

            {validationMessages.length > 0 ? (
              <ul className="space-y-1 text-sm text-warning">
                {validationMessages.map((msg) => (
                  <li key={msg}>· {msg}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-success">Emir doğrulaması geçti — göndermeye hazır.</p>
            )}
          </CardContent>
        </SpotlightCard>
      </FadeIn>

      <FadeIn delay={200}>
        <SpotlightCard className="rounded-2xl">
          <CardHeader>
            <MicroLabel>( 3 ) Pozisyonlar</MicroLabel>
            <CardTitle className="text-base">Açık pozisyonlar</CardTitle>
            <CardDescription>Canlı simülasyon defteri · ~15 sn yenilenir</CardDescription>
          </CardHeader>
          <CardContent>
            {account.openPositions.length === 0 ? (
              <EmptyState
                title="Henüz açık pozisyon yok"
                description="Yukarıdan sanal emir açın ya da AI sinyallerinden tek tıkla deneyin."
                actionLabel="Sinyallere git"
                onAction={() => {
                  window.location.href = "/signals";
                }}
              />
            ) : (
              <AnimatedList maxVisible={12} itemHeight={52}>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Sembol</TableHead>
                        <TableHead>Yön</TableHead>
                        <TableHead>Adet</TableHead>
                        <TableHead>Giriş</TableHead>
                        <TableHead>Marka</TableHead>
                        <TableHead>K/Z</TableHead>
                        <TableHead>Kaynak</TableHead>
                        <TableHead className="text-right">İşlem</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {account.openPositions.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell>
                            <SymbolWithLogo symbol={p.symbol} size="sm" />
                          </TableCell>
                          <TableCell>{sideLabel(p.side)}</TableCell>
                          <TableCell className="font-mono">{p.quantity}</TableCell>
                          <TableCell className="font-mono">{formatNumber(p.entryPrice)}</TableCell>
                          <TableCell className="font-mono">{formatNumber(p.currentPrice)}</TableCell>
                          <TableCell
                            className={cn(
                              "font-mono",
                              p.pnl >= 0 ? "text-success" : "text-destructive",
                            )}
                          >
                            {formatCurrency(p.pnl)}
                          </TableCell>
                          <TableCell>
                            <SourceBadge source={p.source} />
                          </TableCell>
                          <TableCell className="text-right">
                            {confirmCloseId === p.id ? (
                              <div className="inline-flex items-center gap-1.5">
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  disabled={closingId === p.id}
                                  onClick={() => void closePosition(p)}
                                >
                                  {closingId === p.id ? "…" : "Onayla"}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={closingId === p.id}
                                  onClick={() => setConfirmCloseId(null)}
                                >
                                  Vazgeç
                                </Button>
                              </div>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setConfirmCloseId(p.id)}
                              >
                                Kapat
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </AnimatedList>
            )}
          </CardContent>
        </SpotlightCard>
      </FadeIn>

      <FadeIn delay={260}>
        <SpotlightCard className="rounded-2xl">
          <CardHeader>
            <MicroLabel>( 4 ) Geçmiş</MicroLabel>
            <CardTitle className="text-base">Kapalı işlemler</CardTitle>
          </CardHeader>
          <CardContent>
            {account.closedTrades.length === 0 ? (
              <EmptyState
                title="Henüz kapalı işlem yok"
                description="Pozisyon kapattığınızda veya stop/hedef tetiklendiğinde burada listelenir."
              />
            ) : (
              <AnimatedList maxVisible={12} itemHeight={52}>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Sembol</TableHead>
                        <TableHead>Yön</TableHead>
                        <TableHead>Adet</TableHead>
                        <TableHead>Giriş</TableHead>
                        <TableHead>Çıkış</TableHead>
                        <TableHead>K/Z</TableHead>
                        <TableHead>Kaynak</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {account.closedTrades.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell>
                            <SymbolWithLogo symbol={p.symbol} size="sm" />
                          </TableCell>
                          <TableCell>{sideLabel(p.side)}</TableCell>
                          <TableCell className="font-mono">{p.quantity}</TableCell>
                          <TableCell className="font-mono">{formatNumber(p.entryPrice)}</TableCell>
                          <TableCell className="font-mono">{formatNumber(p.currentPrice)}</TableCell>
                          <TableCell
                            className={cn(
                              "font-mono",
                              p.pnl >= 0 ? "text-success" : "text-destructive",
                            )}
                          >
                            {formatCurrency(p.pnl)}
                          </TableCell>
                          <TableCell>
                            <SourceBadge source={p.source} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </AnimatedList>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              İpucu:{" "}
              <Link href="/signals" className="text-primary underline-offset-2 hover:underline">
                AI sinyalleri
              </Link>{" "}
              sayfasından da simülasyona aktarım yapabilirsiniz.
            </p>
          </CardContent>
        </SpotlightCard>
      </FadeIn>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  signed,
}: {
  label: string;
  value: number;
  tone?: "success" | "destructive";
  signed?: boolean;
}) {
  return (
    <SpotlightCard className="rounded-2xl">
      <CardContent className="py-5">
        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{label}</p>
        <p
          className={cn(
            "mt-2 font-mono text-2xl font-medium",
            tone === "success" && "text-success",
            tone === "destructive" && "text-destructive",
          )}
        >
          <CountUp
            end={Math.abs(value)}
            prefix={signed ? (value >= 0 ? "+$" : "-$") : "$"}
            decimals={2}
          />
        </p>
      </CardContent>
    </SpotlightCard>
  );
}

function PnlSparkline({ values }: { values: number[] }) {
  const width = 160;
  const height = 40;
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const span = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / span) * (height - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");
  const last = values[values.length - 1] ?? 0;
  const stroke = last >= 0 ? "hsl(var(--success))" : "hsl(var(--destructive))";

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-10 w-full max-w-[200px]"
      aria-hidden
    >
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth="1.75"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points}
      />
    </svg>
  );
}
