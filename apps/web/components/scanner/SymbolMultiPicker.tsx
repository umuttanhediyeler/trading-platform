"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, Search, Star, X } from "lucide-react";
import { apiClient, type MarketSymbol } from "@/lib/api-client";
import { StockLogo } from "@/components/shared/StockLogo";
import { cn } from "@/lib/utils";

const MAX_VISIBLE_RESULTS = 60;
const REMOTE_SEARCH_MIN = 2;

interface SymbolMultiPickerProps {
  symbols: MarketSymbol[];
  value: string[];
  onChange: (symbols: string[]) => void;
  loading?: boolean;
  placeholder?: string;
  token?: string;
}

export function SymbolMultiPicker({
  symbols,
  value,
  onChange,
  loading = false,
  placeholder = "Hisse ara ve ekle…",
  token,
}: SymbolMultiPickerProps) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [remoteHits, setRemoteHits] = useState<MarketSymbol[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 180);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!token || debouncedQuery.length < REMOTE_SEARCH_MIN) {
      setRemoteHits([]);
      setRemoteLoading(false);
      return;
    }
    let cancelled = false;
    setRemoteLoading(true);
    apiClient
      .getMarketSymbols(token, debouncedQuery)
      .then((rows) => {
        if (!cancelled) setRemoteHits(rows);
      })
      .catch(() => {
        if (!cancelled) setRemoteHits([]);
      })
      .finally(() => {
        if (!cancelled) setRemoteLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, token]);

  const selectedSet = useMemo(() => new Set(value.map((s) => s.toUpperCase())), [value]);

  const selectedMeta = useMemo(() => {
    const bySymbol = new Map(symbols.map((s) => [s.symbol.toUpperCase(), s]));
    for (const hit of remoteHits) {
      bySymbol.set(hit.symbol.toUpperCase(), hit);
    }
    return value.map((sym) => {
      const key = sym.toUpperCase();
      return bySymbol.get(key) ?? { symbol: key, name: key, inWatchlist: false };
    });
  }, [remoteHits, symbols, value]);

  const results = useMemo(() => {
    const needle = debouncedQuery.toLowerCase();
    const rank = (item: MarketSymbol) =>
      Number(item.inWatchlist) * 2 + Number(item.inUniverse ?? false);

    const catalog = new Map<string, MarketSymbol>();
    for (const item of symbols) catalog.set(item.symbol.toUpperCase(), item);
    for (const item of remoteHits) catalog.set(item.symbol.toUpperCase(), item);
    const all = [...catalog.values()];

    let pool = all;
    if (needle) {
      pool = all.filter(
        (item) =>
          item.symbol.toLowerCase().includes(needle) ||
          item.name.toLowerCase().includes(needle),
      );
    } else {
      pool = [...all]
        .filter((item) => item.inWatchlist || item.inUniverse)
        .sort((a, b) => rank(b) - rank(a) || a.symbol.localeCompare(b.symbol));
    }

    return {
      items: pool.slice(0, MAX_VISIBLE_RESULTS),
      total: pool.length,
    };
  }, [debouncedQuery, remoteHits, symbols]);

  const filtered = results.items;

  useEffect(() => {
    setActiveIndex(0);
  }, [debouncedQuery]);

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

  function toggle(symbol: string) {
    const key = symbol.toUpperCase();
    if (selectedSet.has(key)) {
      onChange(value.filter((s) => s.toUpperCase() !== key));
    } else {
      onChange([...value, key]);
    }
    setQuery("");
    inputRef.current?.focus();
  }

  function remove(symbol: string) {
    const key = symbol.toUpperCase();
    onChange(value.filter((s) => s.toUpperCase() !== key));
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
      toggle(filtered[activeIndex].symbol);
    } else if (event.key === "Backspace" && !query && value.length > 0) {
      remove(value[value.length - 1]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setQuery("");
    }
  }

  return (
    <div ref={rootRef} className="relative w-full">
      <div
        className={cn(
          "min-h-12 rounded-2xl border border-border/80 bg-gradient-to-br from-card via-card to-secondary/20 p-2 shadow-sm transition-all",
          open && "border-primary/50 ring-2 ring-primary/15",
        )}
        onClick={() => inputRef.current?.focus()}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          {selectedMeta.map((item) => (
            <button
              key={item.symbol}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                remove(item.symbol);
              }}
              className="group inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/80 py-1 pl-1 pr-2 text-xs shadow-sm transition hover:border-destructive/40 hover:bg-destructive/5"
              aria-label={`${item.symbol} kaldır`}
            >
              <StockLogo symbol={item.symbol} size="sm" />
              <span className="font-mono font-semibold tracking-wide">{item.symbol}</span>
              <X className="h-3 w-3 text-muted-foreground transition group-hover:text-destructive" />
            </button>
          ))}
          <div className="flex min-w-[140px] flex-1 items-center gap-2 px-1">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              role="combobox"
              aria-label="Watchlist hissesi ara"
              aria-expanded={open}
              aria-controls={listboxId}
              aria-autocomplete="list"
              autoComplete="off"
              value={query}
              placeholder={
                loading
                  ? "Hisseler yükleniyor…"
                  : value.length === 0
                    ? placeholder
                    : "Daha fazla ekle…"
              }
              disabled={loading}
              onFocus={() => setOpen(true)}
              onChange={(event) => {
                setQuery(event.target.value);
                setOpen(true);
              }}
              onKeyDown={handleKeyDown}
              className="h-8 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
        </div>
      </div>

      {open ? (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 overflow-hidden rounded-2xl border border-border bg-card/95 shadow-2xl backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-border/70 px-3 py-2 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            <span>
              {query.trim()
                ? remoteLoading
                  ? "Aranıyor…"
                  : `${results.total} sonuç`
                : "Önerilen hisseler"}
            </span>
            <span className="normal-case tracking-normal text-muted-foreground/80">
              {value.length} seçili
            </span>
          </div>
          <ul id={listboxId} role="listbox" aria-multiselectable className="max-h-72 overflow-y-auto p-1.5">
            {filtered.length === 0 ? (
              <li className="px-3 py-8 text-center text-sm text-muted-foreground">
                “{query}” için sonuç yok
              </li>
            ) : (
              filtered.map((item, index) => {
                const selected = selectedSet.has(item.symbol.toUpperCase());
                return (
                  <li
                    key={item.symbol}
                    id={`${listboxId}-${item.symbol}`}
                    role="option"
                    aria-selected={selected}
                    onMouseEnter={() => setActiveIndex(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => toggle(item.symbol)}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 transition-colors",
                      index === activeIndex ? "bg-accent/80" : "hover:bg-secondary/50",
                      selected && "bg-primary/5",
                    )}
                  >
                    <StockLogo symbol={item.symbol} size="md" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-semibold">{item.symbol}</span>
                        {item.inWatchlist ? (
                          <Star className="h-3 w-3 fill-current text-primary" />
                        ) : null}
                        {item.inUniverse ? (
                          <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary">
                            AI
                          </span>
                        ) : null}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{item.name}</p>
                    </div>
                    <span
                      className={cn(
                        "flex h-6 w-6 items-center justify-center rounded-full border transition",
                        selected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border text-transparent",
                      )}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </span>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
