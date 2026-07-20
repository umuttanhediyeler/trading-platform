import type { Candle } from "@/lib/types";
import type { LineData, HistogramData } from "lightweight-charts";

export type IndicatorType = "sma" | "ema" | "bollinger" | "rsi" | "macd" | "volume";

export interface CustomIndicator {
  id: string;
  type: IndicatorType;
  period: number;
  color: string;
  /** Bollinger only */
  stdDev?: number;
  /** MACD only */
  slowPeriod?: number;
  /** MACD only */
  signalPeriod?: number;
}

export type DrawingTool = "cursor" | "trend" | "hline" | "ray" | "fib" | "rect";

export interface ChartPoint {
  time: number;
  price: number;
}

export interface Drawing {
  id: string;
  type: Exclude<DrawingTool, "cursor">;
  points: ChartPoint[];
  color: string;
}

export const INDICATOR_PRESETS: Array<{
  type: IndicatorType;
  label: string;
  defaultPeriod: number;
  defaultColor: string;
  needsPeriod: boolean;
}> = [
  { type: "sma", label: "SMA", defaultPeriod: 20, defaultColor: "#38bdf8", needsPeriod: true },
  { type: "ema", label: "EMA", defaultPeriod: 50, defaultColor: "#f59e0b", needsPeriod: true },
  { type: "bollinger", label: "Bollinger", defaultPeriod: 20, defaultColor: "#a855f7", needsPeriod: true },
  { type: "rsi", label: "RSI", defaultPeriod: 14, defaultColor: "#22d3ee", needsPeriod: true },
  { type: "macd", label: "MACD", defaultPeriod: 12, defaultColor: "#34d399", needsPeriod: true },
  { type: "volume", label: "Hacim", defaultPeriod: 0, defaultColor: "#64748b", needsPeriod: false },
];

export const DRAWING_COLORS = [
  "#38bdf8",
  "#f59e0b",
  "#a855f7",
  "#22c55e",
  "#ef4444",
  "#e2e8f0",
];

export function uid(prefix = "id") {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

export function movingAverage(data: Candle[], period: number): LineData[] {
  if (period < 1 || data.length < period) return [];
  return data.slice(period - 1).map((c, index) => {
    const window = data.slice(index, index + period);
    return {
      time: c.time as LineData["time"],
      value: window.reduce((sum, item) => sum + item.close, 0) / period,
    };
  });
}

export function exponentialMovingAverage(data: Candle[], period: number): LineData[] {
  if (period < 1 || data.length < period) return [];
  const multiplier = 2 / (period + 1);
  let value = data.slice(0, period).reduce((sum, item) => sum + item.close, 0) / period;
  const result: LineData[] = [{ time: data[period - 1].time as LineData["time"], value }];
  for (let i = period; i < data.length; i += 1) {
    value = (data[i].close - value) * multiplier + value;
    result.push({ time: data[i].time as LineData["time"], value });
  }
  return result;
}

export function bollingerBands(data: Candle[], period: number, deviations: number) {
  const upper: LineData[] = [];
  const middle: LineData[] = [];
  const lower: LineData[] = [];
  if (period < 1) return { upper, middle, lower };
  for (let i = period - 1; i < data.length; i += 1) {
    const values = data.slice(i - period + 1, i + 1).map((c) => c.close);
    const mean = values.reduce((sum, value) => sum + value, 0) / period;
    const variance =
      values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / period;
    const deviation = Math.sqrt(variance) * deviations;
    const time = data[i].time as LineData["time"];
    upper.push({ time, value: mean + deviation });
    middle.push({ time, value: mean });
    lower.push({ time, value: mean - deviation });
  }
  return { upper, middle, lower };
}

export function relativeStrengthIndex(data: Candle[], period: number): LineData[] {
  if (period < 1 || data.length <= period) return [];
  const changes: number[] = [];
  for (let i = 1; i < data.length; i += 1) {
    changes.push(data[i].close - data[i - 1].close);
  }
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i += 1) {
    const change = changes[i];
    if (change >= 0) avgGain += change;
    else avgLoss -= change;
  }
  avgGain /= period;
  avgLoss /= period;

  const result: LineData[] = [];
  const firstRs = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  result.push({ time: data[period].time as LineData["time"], value: firstRs });

  for (let i = period; i < changes.length; i += 1) {
    const change = changes[i];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);
    result.push({ time: data[i + 1].time as LineData["time"], value: rsi });
  }
  return result;
}

export function movingAverageConvergenceDivergence(
  data: Candle[],
  fastPeriod: number,
  slowPeriod: number,
  signalPeriod: number,
) {
  const macd: LineData[] = [];
  const signal: LineData[] = [];
  if (
    fastPeriod < 1 ||
    slowPeriod <= fastPeriod ||
    signalPeriod < 1 ||
    data.length < slowPeriod
  ) {
    return { macd, signal };
  }

  const fast = exponentialMovingAverage(data, fastPeriod);
  const slow = exponentialMovingAverage(data, slowPeriod);
  const fastByTime = new Map(fast.map((point) => [String(point.time), point.value]));

  for (const point of slow) {
    const fastValue = fastByTime.get(String(point.time));
    if (fastValue != null) {
      macd.push({ time: point.time, value: fastValue - point.value });
    }
  }

  if (macd.length < signalPeriod) return { macd, signal };
  const multiplier = 2 / (signalPeriod + 1);
  let signalValue =
    macd.slice(0, signalPeriod).reduce((sum, point) => sum + point.value, 0) / signalPeriod;
  signal.push({ time: macd[signalPeriod - 1].time, value: signalValue });
  for (let index = signalPeriod; index < macd.length; index += 1) {
    signalValue = (macd[index].value - signalValue) * multiplier + signalValue;
    signal.push({ time: macd[index].time, value: signalValue });
  }

  return { macd, signal };
}

export function volumeHistogram(data: Candle[]): HistogramData[] {
  return data.map((c) => ({
    time: c.time as HistogramData["time"],
    value: c.volume ?? 0,
    color: c.close >= c.open ? "rgba(34,197,94,.35)" : "rgba(239,68,68,.35)",
  }));
}

/** Points needed to complete a drawing for each tool. */
export function pointsNeeded(tool: DrawingTool): number {
  switch (tool) {
    case "hline":
      return 1;
    case "trend":
    case "ray":
    case "fib":
    case "rect":
      return 2;
    default:
      return 0;
  }
}
