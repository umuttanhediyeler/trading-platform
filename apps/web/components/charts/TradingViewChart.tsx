"use client";

import { useEffect, useRef } from "react";
import { ExternalLink } from "lucide-react";

export function TradingViewChart({
  symbol,
  height,
}: {
  symbol: string | null | undefined;
  height: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !symbol) return;

    container.replaceChildren();
    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget h-full w-full";
    const copyright = document.createElement("div");
    copyright.className =
      "tradingview-widget-copyright px-3 py-1 text-[10px] text-muted-foreground";
    copyright.innerHTML =
      '<a href="https://www.tradingview.com/" rel="noopener nofollow" target="_blank"><span class="blue-text">TradingView grafiği</span></a>';

    const script = document.createElement("script");
    script.type = "text/javascript";
    script.src =
      "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.async = true;
    script.text = JSON.stringify({
      autosize: true,
      symbol,
      interval: "D",
      timezone: "Etc/UTC",
      theme: "dark",
      style: "1",
      locale: "tr",
      backgroundColor: "rgba(10, 10, 10, 1)",
      gridColor: "rgba(255, 255, 255, 0.05)",
      hide_top_toolbar: false,
      hide_side_toolbar: false,
      allow_symbol_change: false,
      save_image: false,
      calendar: false,
      support_host: "https://www.tradingview.com",
    });

    container.append(widget, copyright, script);
  }, [symbol]);

  if (!symbol) {
    return (
      <div
        className="flex items-center justify-center rounded-xl border border-dashed border-border bg-terminal text-sm text-muted-foreground"
        style={{ height }}
      >
        TradingView grafiği için bir hisse seçin.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-[#0a0a0a]">
      <div
        ref={containerRef}
        className="tradingview-widget-container w-full"
        style={{ height }}
      />
      <div className="flex items-center justify-between border-t border-border/60 px-3 py-2 text-[10px] text-muted-foreground">
        <span>
          Üst araç çubuğundaki “Indicators” menüsünden TradingView indikatörlerini
          ekleyebilirsiniz.
        </span>
        <a
          href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
        >
          TradingView’da aç <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}
