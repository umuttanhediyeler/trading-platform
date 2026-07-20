"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import type { IndicatorType } from "@/lib/chart-tools";
import { cn } from "@/lib/utils";

const GROUPS: Array<{
  category: string;
  items: Array<{ type: IndicatorType; name: string; description: string }>;
}> = [
  {
    category: "Trend",
    items: [
      { type: "sma", name: "SMA", description: "Basit hareketli ortalama ile ana trendi izler." },
      { type: "ema", name: "EMA", description: "Son fiyatlara ağırlık veren hareketli ortalama." },
    ],
  },
  {
    category: "Momentum",
    items: [
      { type: "rsi", name: "RSI", description: "Aşırı alım ve satım bölgelerini ölçer." },
      { type: "macd", name: "MACD", description: "Trend yönü ile momentum değişimini karşılaştırır." },
    ],
  },
  {
    category: "Volatilite",
    items: [
      {
        type: "bollinger",
        name: "Bollinger Bands",
        description: "Fiyatın oynaklık bantlarındaki konumunu gösterir.",
      },
    ],
  },
  {
    category: "Hacim",
    items: [
      { type: "volume", name: "Volume", description: "İşlem hacmini fiyat hareketiyle birlikte gösterir." },
    ],
  },
];

export function IndicatorPicker({ onAdd }: { onAdd: (type: IndicatorType) => void }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("tr-TR");
    if (!needle) return GROUPS;
    return GROUPS.map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          item.name.toLocaleLowerCase("tr-TR").includes(needle) ||
          item.description.toLocaleLowerCase("tr-TR").includes(needle),
      ),
    })).filter((group) => group.items.length > 0);
  }, [query]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  function add(type: IndicatorType) {
    onAdd(type);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        className={cn(
          "flex h-8 items-center gap-2 rounded-xl border border-border bg-card/80 px-3 text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground backdrop-blur transition-colors hover:text-foreground",
          open && "border-primary/50 text-foreground",
        )}
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        İndikatörler
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="İndikatör seç"
          className="absolute right-0 top-10 z-50 w-[360px] overflow-hidden rounded-2xl border border-border bg-card/95 shadow-2xl backdrop-blur"
        >
          <div className="border-b border-border p-3">
            <div className="flex h-10 items-center rounded-xl border border-border bg-background/70 px-3 focus-within:border-primary/50">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="İndikatör ara…"
                aria-label="İndikatör ara"
                className="h-full min-w-0 flex-1 bg-transparent px-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
              />
            </div>
          </div>

          <div className="max-h-[390px] overflow-y-auto p-2">
            {groups.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                “{query}” için sonuç bulunamadı
              </p>
            ) : (
              groups.map((group) => (
                <section key={group.category} className="mb-2 last:mb-0">
                  <p className="px-3 py-2 text-[9px] font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                    {group.category}
                  </p>
                  {group.items.map((item) => (
                    <button
                      key={item.type}
                      type="button"
                      onClick={() => add(item.type)}
                      className="group flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-accent"
                    >
                      <span className="mt-0.5 w-16 shrink-0 font-mono text-xs font-semibold text-foreground">
                        {item.name}
                      </span>
                      <span className="text-xs leading-5 text-muted-foreground group-hover:text-foreground/75">
                        {item.description}
                      </span>
                    </button>
                  ))}
                </section>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
