"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, Star } from "lucide-react";
import type { MarketSymbol } from "@/lib/api-client";
import { StockLogo } from "@/components/shared/StockLogo";
import { cn } from "@/lib/utils";

const MAX_VISIBLE_RESULTS = 50;

interface SymbolPickerProps {
  symbols: MarketSymbol[];
  value: string | null | undefined;
  onChange: (symbol: string) => void;
  loading?: boolean;
}

export function SymbolPicker({ symbols, value, onChange, loading = false }: SymbolPickerProps) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const selected = symbols.find(({ symbol }) => symbol === value);
  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      const defaults = symbols
        .filter(({ inWatchlist, inUniverse }) => inWatchlist || inUniverse)
        .sort(
          (a, b) =>
            Number(b.inWatchlist) - Number(a.inWatchlist) ||
            Number(b.inUniverse) - Number(a.inUniverse),
        )
        .slice(0, MAX_VISIBLE_RESULTS);
      return { items: defaults, total: defaults.length };
    }

    const items: MarketSymbol[] = [];
    let total = 0;
    for (const item of symbols) {
      if (
        item.symbol.toLowerCase().includes(needle) ||
        item.name.toLowerCase().includes(needle)
      ) {
        total += 1;
        if (items.length < MAX_VISIBLE_RESULTS) items.push(item);
      }
    }
    return { items, total };
  }, [query, symbols]);
  const filtered = results.items;

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open || !filtered[activeIndex]) return;
    document
      .getElementById(`${listboxId}-${filtered[activeIndex].symbol}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, filtered, listboxId, open]);

  useEffect(() => {
    function closeOnOutsideClick(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, []);

  function choose(symbol: string) {
    onChange(symbol);
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => (open ? Math.min(index + 1, filtered.length - 1) : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => (open ? Math.max(index - 1, 0) : filtered.length - 1));
    } else if (event.key === "Enter" && open && filtered[activeIndex]) {
      event.preventDefault();
      choose(filtered[activeIndex].symbol);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setQuery("");
      inputRef.current?.blur();
    }
  }

  const displayValue = open ? query : selected ? `${selected.symbol} — ${selected.name}` : value ?? "";

  return (
    <div ref={rootRef} className="relative min-w-[260px] max-w-md flex-1">
      <div
        className={cn(
          "group flex h-10 items-center rounded-lg border border-border bg-card shadow-sm transition-colors",
          open && "border-primary/60 ring-2 ring-primary/15",
        )}
      >
        <Search className="ml-3 h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          role="combobox"
          aria-label="Hisse ara"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={
            open && filtered[activeIndex]
              ? `${listboxId}-${filtered[activeIndex].symbol}`
              : undefined
          }
          aria-autocomplete="list"
          autoComplete="off"
          value={displayValue}
          placeholder={loading ? "Hisseler yükleniyor…" : "Kod veya şirket adı ara…"}
          disabled={loading}
          onFocus={(event) => {
            setOpen(true);
            setQuery("");
            event.currentTarget.select();
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          className="h-full min-w-0 flex-1 bg-transparent px-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        <ChevronDown
          className={cn(
            "mr-3 h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </div>

      {open ? (
        <div className="absolute left-0 top-12 z-50 w-full min-w-[320px] overflow-hidden rounded-lg border border-border bg-card shadow-2xl">
          <div className="border-b border-border px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {query.trim()
              ? `${results.total} eşleşme${results.total > MAX_VISIBLE_RESULTS ? ` · ilk ${MAX_VISIBLE_RESULTS}` : ""}`
              : "İzleme listeniz ve AI evreni"}
          </div>
          <ul id={listboxId} role="listbox" className="max-h-72 overflow-y-auto p-1.5">
            {filtered.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                “{query}” için sonuç bulunamadı
              </li>
            ) : (
              filtered.map((item, index) => (
                <li
                  key={item.symbol}
                  id={`${listboxId}-${item.symbol}`}
                  role="option"
                  aria-selected={item.symbol === value}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(item.symbol)}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 transition-colors",
                    index === activeIndex ? "bg-accent text-accent-foreground" : "text-foreground",
                  )}
                >
                  <StockLogo symbol={item.symbol} size="sm" />
                  <span className="w-14 shrink-0 font-mono text-sm font-semibold">{item.symbol}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                    {item.name}
                  </span>
                  {item.inWatchlist ? (
                    <Star className="h-3.5 w-3.5 fill-current text-primary" aria-label="İzleme listesinde" />
                  ) : null}
                  {item.inUniverse ? (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold text-primary">
                      AI
                    </span>
                  ) : null}
                  {item.symbol === value ? <Check className="h-4 w-4 text-primary" /> : null}
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
