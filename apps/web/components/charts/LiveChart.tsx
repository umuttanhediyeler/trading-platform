"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import {
  AreaChart,
  BarChart2,
  CandlestickChart,
  ChevronLeft,
  ChevronRight,
  Expand,
  LineChart,
  Minimize2,
  MousePointer2,
  Minus,
  TrendingUp,
  Square,
  MoveRight,
  Percent,
  Trash2,
  Plus,
  X,
  Maximize2,
} from "lucide-react";
import { PriceChart, type ChartApi, type SeriesType } from "./PriceChart";
import { DrawingOverlay } from "./DrawingOverlay";
import { IndicatorPicker } from "./IndicatorPicker";
import { SymbolPicker } from "./SymbolPicker";
import { TradingViewChart } from "./TradingViewChart";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useBars, type BarsTimeframe } from "@/lib/hooks/use-bars";
import { apiClient, type MarketSymbol } from "@/lib/api-client";
import {
  type CustomIndicator,
  type Drawing,
  type DrawingTool,
  type IndicatorType,
  DRAWING_COLORS,
  INDICATOR_PRESETS,
  uid,
} from "@/lib/chart-tools";
import { cn } from "@/lib/utils";

const TIMEFRAMES: Array<{ value: BarsTimeframe; label: string }> = [
  { value: "5min", label: "5m" },
  { value: "15min", label: "15m" },
  { value: "1h", label: "1s" },
  { value: "1d", label: "1G" },
];

const INDICATOR_STORAGE_KEY = "chart-indicators-v1";

const SERIES_TYPES: Array<{
  value: SeriesType;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { value: "candles", label: "Mum", icon: CandlestickChart },
  { value: "bars", label: "Bar", icon: BarChart2 },
  { value: "line", label: "Çizgi", icon: LineChart },
  { value: "area", label: "Alan", icon: AreaChart },
];

const DRAW_TOOLS: Array<{
  value: DrawingTool;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  hint: string;
}> = [
  { value: "cursor", label: "İmleç", icon: MousePointer2, hint: "Pan / zoom" },
  { value: "trend", label: "Trend", icon: TrendingUp, hint: "2 nokta" },
  { value: "hline", label: "Yatay", icon: Minus, hint: "1 nokta" },
  { value: "ray", label: "Işın", icon: MoveRight, hint: "2 nokta" },
  { value: "rect", label: "Kutu", icon: Square, hint: "2 nokta" },
  { value: "fib", label: "Fib", icon: Percent, hint: "Fibonacci" },
];

/**
 * Full chart workspace: live Alpaca bars, custom indicators, drawing tools,
 * and fullscreen.
 */
export function LiveChart({
  symbol,
  height = 300,
  className,
  onSymbolChange,
}: {
  symbol: string | null | undefined;
  height?: number;
  className?: string;
  /** Fired when the chart picker (or prop sync) selects a symbol. */
  onSymbolChange?: (symbol: string) => void;
}) {
  const { data: session } = useSession();
  const token = session?.accessToken;
  const [activeSymbol, setActiveSymbol] = useState(symbol ?? "AAPL");
  const [symbols, setSymbols] = useState<MarketSymbol[]>([]);
  const [symbolsLoading, setSymbolsLoading] = useState(true);
  const [timeframe, setTimeframe] = useState<BarsTimeframe>("1d");
  const [seriesType, setSeriesType] = useState<SeriesType>("candles");
  const [indicators, setIndicators] = useState<CustomIndicator[]>([
    { id: "vol-default", type: "volume", period: 0, color: "#737373" },
  ]);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [tool, setTool] = useState<DrawingTool>("cursor");
  const [drawColor, setDrawColor] = useState(DRAWING_COLORS[0]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [chartMode, setChartMode] = useState<"native" | "tradingview">("native");
  const [chartApi, setChartApi] = useState<ChartApi | null>(null);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const indicatorsHydratedRef = useRef(false);
  const { candles, provider, loading, error } = useBars(activeSymbol, timeframe);

  useEffect(() => {
    if (!symbol) return;
    setActiveSymbol(symbol);
  }, [symbol]);

  function selectSymbol(next: string) {
    const upper = next.trim().toUpperCase();
    if (!upper) return;
    setActiveSymbol(upper);
    onSymbolChange?.(upper);
  }
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(INDICATOR_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as unknown;
        const validTypes = new Set<IndicatorType>([
          "sma",
          "ema",
          "bollinger",
          "rsi",
          "macd",
          "volume",
        ]);
        if (Array.isArray(parsed)) {
          const restored = parsed.filter(
            (item): item is CustomIndicator =>
              typeof item === "object" &&
              item !== null &&
              typeof (item as CustomIndicator).id === "string" &&
              validTypes.has((item as CustomIndicator).type) &&
              Number.isFinite((item as CustomIndicator).period) &&
              typeof (item as CustomIndicator).color === "string",
          );
          setIndicators(restored);
        }
      }
    } catch {
      // Ignore malformed or unavailable local storage.
    } finally {
      indicatorsHydratedRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (!indicatorsHydratedRef.current) return;
    window.localStorage.setItem(INDICATOR_STORAGE_KEY, JSON.stringify(indicators));
  }, [indicators]);

  useEffect(() => {
    if (!token) {
      setSymbolsLoading(false);
      return;
    }
    let cancelled = false;
    setSymbolsLoading(true);
    apiClient
      .getMarketSymbols(token)
      .then((items) => {
        if (!cancelled) setSymbols(items);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setSymbolsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (
      activeSymbol &&
      symbols.length > 0 &&
      !symbols.some(({ symbol: itemSymbol }) => itemSymbol === activeSymbol)
    ) {
      setSymbols((items) => [
        { symbol: activeSymbol, name: activeSymbol, inWatchlist: false },
        ...items,
      ]);
    }
  }, [activeSymbol, symbols]);

  useEffect(() => {
    const onFullscreenChange = () =>
      setIsFullscreen(document.fullscreenElement === wrapperRef.current);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  // Clear drawings when symbol changes — they are price-level specific.
  useEffect(() => {
    setDrawings([]);
  }, [activeSymbol]);

  // Keyboard: +/- zoom, arrow keys pan. Ignore when typing in inputs.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (!chartApi) return;

      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        chartApi.zoomIn();
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        chartApi.zoomOut();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        chartApi.panLeft();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        chartApi.panRight();
      } else if (e.key === "0" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        chartApi.fitContent();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chartApi]);

  const setChartRef = useCallback((api: ChartApi | null) => {
    setChartApi(api);
  }, []);

  function addIndicator(type: IndicatorType) {
    const preset = INDICATOR_PRESETS.find((item) => item.type === type);
    if (!preset) return;
    setIndicators((list) => [
      ...list,
      {
        id: uid("ind"),
        type,
        period: preset.defaultPeriod,
        color: preset.defaultColor,
        stdDev: type === "bollinger" ? 2 : undefined,
        slowPeriod: type === "macd" ? 26 : undefined,
        signalPeriod: type === "macd" ? 9 : undefined,
      },
    ]);
  }

  function removeIndicator(id: string) {
    setIndicators((list) => list.filter((i) => i.id !== id));
  }

  function updateIndicator(id: string, patch: Partial<CustomIndicator>) {
    setIndicators((list) =>
      list.map((indicator) => (indicator.id === id ? { ...indicator, ...patch } : indicator)),
    );
  }

  function completeDrawing(partial: Omit<Drawing, "id">) {
    setDrawings((list) => [...list, { ...partial, id: uid("draw") }]);
  }

  async function toggleFullscreen() {
    if (!wrapperRef.current) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await wrapperRef.current.requestFullscreen();
    }
  }

  const chartHeight = isFullscreen
    ? Math.max(typeof window !== "undefined" ? window.innerHeight - 160 : 420, 420)
    : height;

  return (
    <div
      ref={wrapperRef}
      className={cn(
        "space-y-2 bg-background",
        isFullscreen && "overflow-auto p-4",
        className,
      )}
    >
      {/* Top toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <SymbolPicker
            symbols={symbols}
            value={activeSymbol}
            onChange={selectSymbol}
            loading={symbolsLoading}
          />
          <div className="flex items-center gap-1 rounded-md border border-border bg-panel p-0.5">
            <button
              type="button"
              onClick={() => setChartMode("native")}
              className={cn(
                "rounded px-2.5 py-1 text-xs transition-colors",
                chartMode === "native"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Apex
            </button>
            <button
              type="button"
              onClick={() => setChartMode("tradingview")}
              className={cn(
                "rounded px-2.5 py-1 text-xs transition-colors",
                chartMode === "tradingview"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              TradingView
            </button>
          </div>
          {chartMode === "native" ? (
            <div className="flex items-center gap-1 rounded-md border border-border bg-panel p-0.5">
              {TIMEFRAMES.map((tf) => (
              <button
                key={tf.value}
                type="button"
                onClick={() => setTimeframe(tf.value)}
                className={cn(
                  "rounded px-2.5 py-1 font-mono text-xs transition-colors",
                  timeframe === tf.value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tf.label}
              </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {chartMode === "native" ? (
            <>
          {/* Series type */}
          <div className="flex items-center gap-0.5 rounded-md border border-border bg-panel p-0.5">
            {SERIES_TYPES.map((s) => {
              const Icon = s.icon;
              return (
                <button
                  key={s.value}
                  type="button"
                  title={s.label}
                  onClick={() => setSeriesType(s.value)}
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded transition-colors",
                    seriesType === s.value
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              );
            })}
          </div>

          {/* Zoom / pan */}
          <div className="flex items-center gap-0.5 rounded-md border border-border bg-panel p-0.5">
            <button
              type="button"
              title="Sola kaydır (←)"
              onClick={() => chartApi?.panLeft()}
              className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              title="Uzaklaştır (−)"
              onClick={() => chartApi?.zoomOut()}
              className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title="Yakınlaştır (+)"
              onClick={() => chartApi?.zoomIn()}
              className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title="Sağa kaydır (→)"
              onClick={() => chartApi?.panRight()}
              className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              title="Tümünü göster (0)"
              onClick={() => chartApi?.fitContent()}
              className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Drawing tools */}
          <div className="flex items-center gap-0.5 rounded-md border border-border bg-panel p-0.5">
            {DRAW_TOOLS.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.value}
                  type="button"
                  title={`${t.label} · ${t.hint}`}
                  onClick={() => setTool(t.value)}
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded transition-colors",
                    tool === t.value
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                </button>
              );
            })}
            <div className="mx-1 h-5 w-px bg-border" />
            {DRAWING_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                title="Çizim rengi"
                onClick={() => setDrawColor(c)}
                className={cn(
                  "h-4 w-4 rounded-full border-2 transition-transform",
                  drawColor === c ? "scale-110 border-foreground" : "border-transparent",
                )}
                style={{ backgroundColor: c }}
              />
            ))}
            <button
              type="button"
              title="Çizimleri temizle"
              onClick={() => setDrawings([])}
              disabled={drawings.length === 0}
              className="ml-0.5 flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors hover:text-destructive disabled:opacity-30"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>

          <IndicatorPicker onAdd={addIndicator} />

          {provider ? (
            <Badge variant="outline" className="font-mono text-[10px] uppercase">
              {provider} · canlı veri
            </Badge>
          ) : null}
            </>
          ) : (
            <Badge variant="outline" className="font-mono text-[10px] uppercase">
              TradingView · indikatör kütüphanesi
            </Badge>
          )}

          <button
            type="button"
            onClick={toggleFullscreen}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-panel text-muted-foreground transition-colors hover:text-foreground"
            aria-label={isFullscreen ? "Tam ekrandan çık" : "Tam ekran"}
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Expand className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Active indicator chips */}
      {chartMode === "native" && indicators.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {indicators.map((ind) => {
            const label = INDICATOR_PRESETS.find((item) => item.type === ind.type)?.label ?? ind.type;
            return (
              <span
                key={ind.id}
                className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-border bg-card/80 px-2 font-mono text-[10px] backdrop-blur"
              >
                <label
                  className="relative h-3 w-3 shrink-0 cursor-pointer overflow-hidden rounded-full border border-white/30"
                  style={{ backgroundColor: ind.color }}
                  title="Rengi değiştir"
                >
                  <input
                    type="color"
                    value={ind.color}
                    onChange={(event) => updateIndicator(ind.id, { color: event.target.value })}
                    className="absolute inset-0 h-6 w-6 cursor-pointer opacity-0"
                    aria-label={`${label} rengini değiştir`}
                  />
                </label>
                <span className="uppercase tracking-wider text-foreground">{label}</span>
                {ind.period > 0 ? (
                  <>
                    <span className="text-muted-foreground">(</span>
                    <input
                      type="number"
                      min={2}
                      max={500}
                      value={ind.period}
                      onChange={(event) => {
                        const period = Math.max(2, Math.min(500, Number(event.target.value) || 2));
                        updateIndicator(ind.id, {
                          period,
                          slowPeriod:
                            ind.type === "macd" && period >= (ind.slowPeriod ?? 26)
                              ? period + 14
                              : ind.slowPeriod,
                        });
                      }}
                      className="h-5 w-9 appearance-none rounded border border-border bg-background/60 px-1 text-center text-[10px] text-foreground outline-none focus:border-primary/60 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      aria-label={`${label} periyodu`}
                    />
                    {ind.type === "macd" ? (
                      <span className="text-muted-foreground">
                        ,{ind.slowPeriod ?? 26},{ind.signalPeriod ?? 9}
                      </span>
                    ) : null}
                    <span className="text-muted-foreground">)</span>
                  </>
                ) : null}
                <button
                  type="button"
                  onClick={() => removeIndicator(ind.id)}
                  className="ml-0.5 text-muted-foreground transition-colors hover:text-destructive"
                  aria-label={`${label} indikatörünü kaldır`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            );
          })}
        </div>
      ) : null}

      {chartMode === "native" && tool !== "cursor" ? (
        <p className="text-[11px] text-muted-foreground">
          {tool === "hline"
            ? "Yatay çizgi için grafiğe bir kez tıklayın. Esc ile iptal."
            : "İki nokta seçin. Sağ tık veya Esc ile iptal."}
          {drawings.length > 0 ? ` · ${drawings.length} çizim` : ""}
        </p>
      ) : null}

      {chartMode === "tradingview" ? (
        <TradingViewChart symbol={activeSymbol} height={chartHeight} />
      ) : loading && candles.length === 0 ? (
        <Skeleton className="w-full rounded-lg" style={{ height: chartHeight }} />
      ) : error ? (
        <div
          className="flex w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border bg-terminal text-sm text-muted-foreground"
          style={{ height: chartHeight }}
        >
          <p>Grafik verisi alınamadı</p>
          <p className="font-mono text-xs">{error}</p>
        </div>
      ) : (
        <PriceChart
          ref={setChartRef}
          data={candles}
          height={chartHeight}
          indicators={indicators}
          seriesType={seriesType}
          drawingMode={tool !== "cursor"}
          overlay={
            <DrawingOverlay
              chartApi={chartApi}
              tool={tool}
              drawings={drawings}
              draftColor={drawColor}
              onComplete={completeDrawing}
              onCancelDraft={() => setTool("cursor")}
            />
          }
          footer={
            <span className="font-mono">
              {activeSymbol ?? "—"} · {timeframe} · Alpaca (IEX) gerçek piyasa verisi
            </span>
          }
        />
      )}
    </div>
  );
}
