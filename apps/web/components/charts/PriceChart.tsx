"use client";

import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type LineData,
  type Time,
  ColorType,
} from "lightweight-charts";
import type { Candle } from "@/lib/types";
import {
  type CustomIndicator,
  movingAverage,
  exponentialMovingAverage,
  bollingerBands,
  relativeStrengthIndex,
  movingAverageConvergenceDivergence,
  volumeHistogram,
} from "@/lib/chart-tools";
import { cn } from "@/lib/utils";

export interface ChartApi {
  /** Convert a mouse event over the chart pane to logical time/price. */
  pointFromEvent: (clientX: number, clientY: number) => { time: number; price: number } | null;
  /** Convert logical time/price back to pane-relative pixels. */
  pixelFromPoint: (time: number, price: number) => { x: number; y: number } | null;
  subscribeViewChange: (cb: () => void) => () => void;
  getPaneElement: () => HTMLElement | null;
  zoomIn: () => void;
  zoomOut: () => void;
  panLeft: () => void;
  panRight: () => void;
  fitContent: () => void;
}

export type SeriesType = "candles" | "bars" | "line" | "area";

type MainSeries =
  | ISeriesApi<"Candlestick">
  | ISeriesApi<"Bar">
  | ISeriesApi<"Line">
  | ISeriesApi<"Area">;

export const PriceChart = forwardRef<
  ChartApi,
  {
    data: Candle[];
    className?: string;
    height?: number;
    footer?: React.ReactNode;
    indicators?: CustomIndicator[];
    /** When true, chart pan/zoom is locked so drawing clicks register cleanly. */
    drawingMode?: boolean;
    /** Rendered absolutely over the chart pane (drawing layer, etc.). */
    overlay?: React.ReactNode;
    /** Main series style: candles, bars, line, or area. */
    seriesType?: SeriesType;
  }
>(function PriceChart(
  {
    data,
    className,
    height = 320,
    footer,
    indicators = [],
    drawingMode = false,
    overlay,
    seriesType = "candles",
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<MainSeries | null>(null);
  const overlaySeriesRef = useRef<
    Array<ISeriesApi<"Line"> | ISeriesApi<"Histogram">>
  >([]);

  // Empty deps: methods read live values from refs, and a stable handle
  // keeps the parent's callback ref from firing on every render.
  useImperativeHandle(ref, () => {
    function getRange() {
      return chartRef.current?.timeScale().getVisibleLogicalRange() ?? null;
    }

    function setRange(from: number, to: number) {
      chartRef.current?.timeScale().setVisibleLogicalRange({ from, to });
    }

    return {
      pointFromEvent(clientX, clientY) {
        const chart = chartRef.current;
        const series = seriesRef.current;
        const el = containerRef.current;
        if (!chart || !series || !el) return null;
        const rect = el.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        const time = chart.timeScale().coordinateToTime(x);
        const price = series.coordinateToPrice(y);
        if (time == null || price == null) return null;
        const t = typeof time === "number" ? time : Number(time);
        if (!Number.isFinite(t) || !Number.isFinite(price)) return null;
        return { time: t, price };
      },
      pixelFromPoint(time, price) {
        const chart = chartRef.current;
        const series = seriesRef.current;
        if (!chart || !series) return null;
        const x = chart.timeScale().timeToCoordinate(time as Time);
        const y = series.priceToCoordinate(price);
        if (x == null || y == null) return null;
        return { x, y };
      },
      subscribeViewChange(cb) {
        const chart = chartRef.current;
        if (!chart) return () => undefined;
        chart.timeScale().subscribeVisibleLogicalRangeChange(cb);
        return () => chart.timeScale().unsubscribeVisibleLogicalRangeChange(cb);
      },
      getPaneElement() {
        return containerRef.current;
      },
      zoomIn() {
        const range = getRange();
        if (!range) return;
        const span = range.to - range.from;
        if (span < 2) return;
        const center = (range.from + range.to) / 2;
        const next = Math.max(span * 0.7, 2);
        setRange(center - next / 2, center + next / 2);
      },
      zoomOut() {
        const range = getRange();
        if (!range) return;
        const span = range.to - range.from;
        const center = (range.from + range.to) / 2;
        const next = span * 1.4;
        setRange(center - next / 2, center + next / 2);
      },
      panLeft() {
        const range = getRange();
        if (!range) return;
        const shift = (range.to - range.from) * 0.25;
        setRange(range.from - shift, range.to - shift);
      },
      panRight() {
        const range = getRange();
        if (!range) return;
        const shift = (range.to - range.from) * 0.25;
        setRange(range.from + shift, range.to + shift);
      },
      fitContent() {
        chartRef.current?.timeScale().fitContent();
      },
    };
  }, []);

  // Create / destroy the chart shell exactly once. Height changes are
  // applied via applyOptions below — recreating the chart here would drop
  // the already-set series data (blank chart in fullscreen).
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#9a9a9a",
      },
      grid: {
        vertLines: { color: "rgba(160, 160, 160, 0.08)" },
        horzLines: { color: "rgba(160, 160, 160, 0.08)" },
      },
      rightPriceScale: { borderColor: "rgba(160, 160, 160, 0.2)" },
      timeScale: { borderColor: "rgba(160, 160, 160, 0.2)" },
      crosshair: { mode: 1 },
    });

    chartRef.current = chart;

    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect?.width) {
        chart.applyOptions({ width: rect.width, height: rect.height });
      }
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      overlaySeriesRef.current = [];
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // Lock / unlock interaction for drawing.
  useEffect(() => {
    chartRef.current?.applyOptions({
      handleScroll: !drawingMode,
      handleScale: !drawingMode,
    });
  }, [drawingMode]);

  // Main price series — rebuilt when the series type changes, refilled when
  // data changes.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (seriesRef.current) {
      try {
        chart.removeSeries(seriesRef.current);
      } catch {
        // already removed
      }
      seriesRef.current = null;
    }

    let series: MainSeries;
    if (seriesType === "line") {
      series = chart.addLineSeries({
        color: "#38bdf8",
        lineWidth: 2,
        priceLineVisible: true,
      });
    } else if (seriesType === "area") {
      series = chart.addAreaSeries({
        lineColor: "#38bdf8",
        topColor: "rgba(56, 189, 248, 0.35)",
        bottomColor: "rgba(56, 189, 248, 0.02)",
        lineWidth: 2,
      });
    } else if (seriesType === "bars") {
      series = chart.addBarSeries({
        upColor: "#22c55e",
        downColor: "#ef4444",
        thinBars: false,
      });
    } else {
      series = chart.addCandlestickSeries({
        upColor: "#22c55e",
        downColor: "#ef4444",
        borderVisible: false,
        wickUpColor: "#22c55e",
        wickDownColor: "#ef4444",
      });
    }
    seriesRef.current = series;

    if (seriesType === "line" || seriesType === "area") {
      const points: LineData[] = data.map((c) => ({
        time: c.time as LineData["time"],
        value: c.close,
      }));
      (series as ISeriesApi<"Line"> | ISeriesApi<"Area">).setData(points);
    } else {
      const candles: CandlestickData[] = data.map((c) => ({
        time: c.time as CandlestickData["time"],
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));
      (series as ISeriesApi<"Candlestick"> | ISeriesApi<"Bar">).setData(candles);
    }
    chart.timeScale().fitContent();
  }, [data, seriesType]);

  // Indicator overlays — rebuild whenever indicators or data change.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    for (const s of overlaySeriesRef.current) {
      try {
        chart.removeSeries(s);
      } catch {
        // series may already be gone if chart was remounted
      }
    }
    overlaySeriesRef.current = [];

    for (const ind of indicators) {
      if (ind.type === "sma") {
        const line = chart.addLineSeries({
          color: ind.color,
          lineWidth: 2,
          title: `SMA ${ind.period}`,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        line.setData(movingAverage(data, ind.period));
        overlaySeriesRef.current.push(line);
      } else if (ind.type === "ema") {
        const line = chart.addLineSeries({
          color: ind.color,
          lineWidth: 2,
          title: `EMA ${ind.period}`,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        line.setData(exponentialMovingAverage(data, ind.period));
        overlaySeriesRef.current.push(line);
      } else if (ind.type === "bollinger") {
        const bands = bollingerBands(data, ind.period, ind.stdDev ?? 2);
        const opts = {
          color: ind.color,
          lineWidth: 1 as const,
          priceLineVisible: false,
          lastValueVisible: false,
        };
        const upper = chart.addLineSeries({ ...opts, title: `BB U ${ind.period}` });
        const mid = chart.addLineSeries({
          ...opts,
          color: `${ind.color}99`,
          title: `BB ${ind.period}`,
        });
        const lower = chart.addLineSeries({ ...opts, title: `BB L ${ind.period}` });
        upper.setData(bands.upper);
        mid.setData(bands.middle);
        lower.setData(bands.lower);
        overlaySeriesRef.current.push(upper, mid, lower);
      } else if (ind.type === "rsi") {
        const scaleId = `rsi-${ind.id}`;
        const line = chart.addLineSeries({
          color: ind.color,
          lineWidth: 2,
          title: `RSI ${ind.period}`,
          priceScaleId: scaleId,
          priceLineVisible: false,
          lastValueVisible: true,
          autoscaleInfoProvider: () => ({
            priceRange: { minValue: 0, maxValue: 100 },
          }),
        });
        chart.priceScale(scaleId).applyOptions({
          scaleMargins: { top: 0.75, bottom: 0 },
        });
        line.setData(relativeStrengthIndex(data, ind.period));
        overlaySeriesRef.current.push(line);
      } else if (ind.type === "macd") {
        const slowPeriod = ind.slowPeriod ?? 26;
        const signalPeriod = ind.signalPeriod ?? 9;
        const scaleId = `macd-${ind.id}`;
        const values = movingAverageConvergenceDivergence(
          data,
          ind.period,
          slowPeriod,
          signalPeriod,
        );
        const macd = chart.addLineSeries({
          color: ind.color,
          lineWidth: 2,
          title: `MACD ${ind.period},${slowPeriod},${signalPeriod}`,
          priceScaleId: scaleId,
          priceLineVisible: false,
          lastValueVisible: true,
        });
        const signal = chart.addLineSeries({
          color: `${ind.color}99`,
          lineWidth: 1,
          title: "Sinyal",
          priceScaleId: scaleId,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        chart.priceScale(scaleId).applyOptions({
          scaleMargins: { top: 0.75, bottom: 0 },
        });
        macd.setData(values.macd);
        signal.setData(values.signal);
        overlaySeriesRef.current.push(macd, signal);
      } else if (ind.type === "volume") {
        const vol = chart.addHistogramSeries({
          priceFormat: { type: "volume" },
          priceScaleId: "volume",
          lastValueVisible: false,
          priceLineVisible: false,
          color: ind.color,
        });
        chart.priceScale("volume").applyOptions({
          scaleMargins: { top: 0.78, bottom: 0 },
        });
        vol.setData(volumeHistogram(data));
        overlaySeriesRef.current.push(vol);
      }
    }
  }, [indicators, data]);

  return (
    <div className={cn("overflow-hidden rounded-lg border border-border bg-terminal", className)}>
      <div className="relative w-full" style={{ height }}>
        <div ref={containerRef} className="absolute inset-0" />
        {overlay}
      </div>
      {footer ? (
        <div className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
          {footer}
        </div>
      ) : null}
    </div>
  );
});
