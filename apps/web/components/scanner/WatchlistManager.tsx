"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import type { Watchlist } from "@/lib/types";
import { apiClient, type MarketSymbol } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorState, LoadingBlock } from "@/components/shared/states";
import { StockLogo } from "@/components/shared/StockLogo";
import { SymbolMultiPicker } from "@/components/scanner/SymbolMultiPicker";
import { cn } from "@/lib/utils";

export function WatchlistManager({ token }: { token?: string }) {
  const [items, setItems] = useState<Watchlist[]>([]);
  const [marketSymbols, setMarketSymbols] = useState<MarketSymbol[]>([]);
  const [editing, setEditing] = useState<Watchlist | null>(null);
  const [name, setName] = useState("");
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [symbolsLoading, setSymbolsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setItems(await apiClient.listWatchlists(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Watchlists could not be loaded");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) void load();
    else setLoading(false);
  }, [load, token]);

  useEffect(() => {
    if (!token) {
      setSymbolsLoading(false);
      return;
    }
    let cancelled = false;
    setSymbolsLoading(true);
    apiClient
      .getMarketSymbols(token)
      .then((rows) => {
        if (!cancelled) setMarketSymbols(rows);
      })
      .catch(() => {
        if (!cancelled) setMarketSymbols([]);
      })
      .finally(() => {
        if (!cancelled) setSymbolsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  function resetForm() {
    setEditing(null);
    setName("");
    setSelectedSymbols([]);
  }

  function edit(item: Watchlist) {
    setEditing(item);
    setName(item.name);
    setSelectedSymbols(item.symbols.map((s) => s.toUpperCase()));
  }

  async function save() {
    if (!token || !name.trim() || selectedSymbols.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        const updated = await apiClient.updateWatchlist(token, editing.id, {
          name: name.trim(),
          symbols: selectedSymbols,
        });
        setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      } else {
        const created = await apiClient.createWatchlist(
          token,
          name.trim(),
          selectedSymbols,
        );
        setItems((current) =>
          [...current, created].sort((a, b) => a.name.localeCompare(b.name)),
        );
      }
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Watchlist could not be saved");
    } finally {
      setSaving(false);
    }
  }

  async function remove(item: Watchlist) {
    if (!token || !window.confirm(`“${item.name}” silinsin mi?`)) return;
    try {
      await apiClient.deleteWatchlist(token, item.id);
      setItems((current) => current.filter(({ id }) => id !== item.id));
      if (editing?.id === item.id) resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Watchlist could not be deleted");
    }
  }

  return (
    <Card className="overflow-visible rounded-2xl border-border/70 bg-card/80 backdrop-blur">
      <CardHeader className="pb-3">
        <p className="text-[10px] uppercase tracking-[0.28em] text-muted-foreground">
          Portföy odak
        </p>
        <CardTitle className="font-display text-xl">Watchlists</CardTitle>
        <p className="text-sm text-muted-foreground">
          Logolarla hisse seç, listeni kaydet — scanner ve AI evreni bunu kullanır.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div
          className={cn(
            "space-y-3 rounded-2xl border border-dashed border-border/80 bg-secondary/10 p-3",
            editing && "border-primary/40 bg-primary/5",
          )}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Liste adı (ör. Tech Core)"
              aria-label="Watchlist name"
              className="h-11 max-w-xs rounded-xl"
            />
            {editing ? (
              <Button variant="outline" size="sm" onClick={resetForm} className="rounded-xl">
                <X className="mr-1 h-3.5 w-3.5" />
                İptal
              </Button>
            ) : null}
          </div>

          <SymbolMultiPicker
            symbols={marketSymbols}
            value={selectedSymbols}
            onChange={setSelectedSymbols}
            loading={symbolsLoading}
            placeholder="AAPL, NVDA veya şirket adı ara…"
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {selectedSymbols.length === 0
                ? "En az bir hisse seç"
                : `${selectedSymbols.length} hisse seçili`}
            </p>
            <Button
              onClick={() => void save()}
              disabled={saving || !name.trim() || selectedSymbols.length === 0}
              className="rounded-xl"
            >
              {editing ? <Pencil className="mr-1.5 h-4 w-4" /> : <Plus className="mr-1.5 h-4 w-4" />}
              {editing ? "Güncelle" : "Oluştur"}
            </Button>
          </div>
        </div>

        {error ? <ErrorState description={error} onRetry={() => void load()} /> : null}
        {loading ? <LoadingBlock rows={2} /> : null}
        {!loading && items.length === 0 ? (
          <EmptyState
            title="Henüz watchlist yok"
            description="Yukarıdan isim verip hisseleri logolarla seçerek ilk listenizi oluşturun."
          />
        ) : null}

        <div className="grid gap-3 md:grid-cols-2">
          {items.map((item) => (
            <div
              key={item.id}
              className={cn(
                "group relative overflow-hidden rounded-2xl border border-border/70 bg-gradient-to-br from-card to-secondary/20 p-4 transition-all hover:border-primary/35 hover:shadow-md",
                editing?.id === item.id && "border-primary/50 ring-1 ring-primary/20",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-display text-base font-semibold tracking-tight">{item.name}</p>
                  <p className="mt-0.5 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                    {item.symbols.length} sembol
                  </p>
                </div>
                <div className="flex gap-0.5 opacity-70 transition group-hover:opacity-100">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => edit(item)}
                    aria-label={`Edit ${item.name}`}
                    className="h-8 w-8 rounded-lg"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => void remove(item)}
                    aria-label={`Delete ${item.name}`}
                    className="h-8 w-8 rounded-lg"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {item.symbols.map((symbol) => (
                  <span
                    key={symbol}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/70 py-1 pl-1 pr-2.5 text-xs shadow-sm"
                  >
                    <StockLogo symbol={symbol} size="sm" />
                    <span className="font-mono font-semibold tracking-wide">{symbol}</span>
                  </span>
                ))}
              </div>

              <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-primary/5 blur-2xl transition group-hover:bg-primary/10" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
