"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { apiClient } from "@/lib/api-client";
import type { Candle } from "@/lib/types";
import { connectSocket, onWsEvent } from "@/lib/ws-client";

export type BarsTimeframe = "1min" | "5min" | "15min" | "1h" | "1d";

interface BarsState {
  candles: Candle[];
  provider: string | null;
  loading: boolean;
  error: string | null;
}

const LOOKBACK_DAYS: Record<BarsTimeframe, number> = {
  "1min": 31,
  "5min": 31,
  "15min": 31,
  "1h": 60,
  "1d": 365,
};

const BUCKET_SECONDS: Record<BarsTimeframe, number> = {
  "1min": 60,
  "5min": 5 * 60,
  "15min": 15 * 60,
  "1h": 60 * 60,
  "1d": 24 * 60 * 60,
};

/** Fetches real OHLCV bars for a symbol from the API (Alpaca-backed). */
export function useBars(symbol: string | null | undefined, timeframe: BarsTimeframe = "1d") {
  const { data: session } = useSession();
  const token = session?.accessToken;
  const [state, setState] = useState<BarsState>({
    candles: [],
    provider: null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (!symbol || !token) return;
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));

    apiClient
      .getBars(token, symbol, { timeframe, days: LOOKBACK_DAYS[timeframe] }, controller.signal)
      .then((res) => {
        setState({
          candles: res.bars,
          provider: res.provider,
          loading: false,
          error: null,
        });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        let message = err instanceof Error ? err.message : "Veri alınamadı";
        if (message === "Unauthorized" || message.includes("(401)")) {
          message = "Oturum süresi doldu — sayfayı yenileyin veya tekrar giriş yapın.";
        }
        setState({
          candles: [],
          provider: null,
          loading: false,
          error: message,
        });
      });

    return () => controller.abort();
  }, [symbol, timeframe, token]);

  useEffect(() => {
    if (!symbol || !token) return;
    connectSocket(token);
    return onWsEvent("quote:update", (quote) => {
      if (quote.symbol.toUpperCase() !== symbol.toUpperCase() || quote.price <= 0) return;
      const seconds = Math.floor(quote.ts / 1000);
      const bucketSize = BUCKET_SECONDS[timeframe];
      const bucketTime = Math.floor(seconds / bucketSize) * bucketSize;

      setState((current) => {
        const last = current.candles[current.candles.length - 1];
        if (!last || bucketTime < last.time) return current;
        if (bucketTime === last.time) {
          const updated: Candle = {
            ...last,
            high: Math.max(last.high, quote.price),
            low: Math.min(last.low, quote.price),
            close: quote.price,
            volume: (last.volume ?? 0) + Math.max(quote.volume, 0),
          };
          return {
            ...current,
            candles: [...current.candles.slice(0, -1), updated],
          };
        }
        return {
          ...current,
          candles: [
            ...current.candles,
            {
              time: bucketTime,
              open: quote.price,
              high: quote.price,
              low: quote.price,
              close: quote.price,
              volume: Math.max(quote.volume, 0),
            },
          ],
        };
      });
    });
  }, [symbol, timeframe, token]);

  return state;
}
