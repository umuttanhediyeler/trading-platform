"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import type { Watchlist } from "@/lib/types";
import { apiClient } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorState, LoadingBlock } from "@/components/shared/states";

export function WatchlistManager({ token }: { token?: string }) {
  const [items, setItems] = useState<Watchlist[]>([]);
  const [editing, setEditing] = useState<Watchlist | null>(null);
  const [name, setName] = useState("");
  const [symbols, setSymbols] = useState("");
  const [loading, setLoading] = useState(true);
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

  function resetForm() {
    setEditing(null);
    setName("");
    setSymbols("");
  }

  function edit(item: Watchlist) {
    setEditing(item);
    setName(item.name);
    setSymbols(item.symbols.join(", "));
  }

  async function save() {
    if (!token || !name.trim()) return;
    const parsed = symbols.split(/[\s,]+/).filter(Boolean);
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        const updated = await apiClient.updateWatchlist(token, editing.id, {
          name: name.trim(),
          symbols: parsed,
        });
        setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      } else {
        const created = await apiClient.createWatchlist(token, name.trim(), parsed);
        setItems((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name)));
      }
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Watchlist could not be saved");
    } finally {
      setSaving(false);
    }
  }

  async function remove(item: Watchlist) {
    if (!token || !window.confirm(`Delete “${item.name}”?`)) return;
    try {
      await apiClient.deleteWatchlist(token, item.id);
      setItems((current) => current.filter(({ id }) => id !== item.id));
      if (editing?.id === item.id) resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Watchlist could not be deleted");
    }
  }

  return (
    <Card className="rounded-2xl bg-card/80 backdrop-blur">
      <CardHeader>
        <CardTitle>Watchlists</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 md:grid-cols-[1fr_2fr_auto]">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Watchlist name"
            aria-label="Watchlist name"
          />
          <Input
            value={symbols}
            onChange={(event) => setSymbols(event.target.value)}
            placeholder="AAPL, MSFT, NVDA"
            aria-label="Watchlist symbols"
          />
          <div className="flex gap-2">
            <Button onClick={() => void save()} disabled={saving || !name.trim() || !symbols.trim()}>
              {editing ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {editing ? "Update" : "Create"}
            </Button>
            {editing ? (
              <Button variant="outline" size="icon" onClick={resetForm} aria-label="Cancel editing">
                <X className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        </div>

        {error ? <ErrorState description={error} onRetry={() => void load()} /> : null}
        {loading ? <LoadingBlock rows={2} /> : null}
        {!loading && items.length === 0 ? (
          <EmptyState
            title="No watchlists"
            description="Create a watchlist above to keep a reusable set of symbols."
          />
        ) : null}
        <div className="grid gap-2 md:grid-cols-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-start justify-between rounded-xl border border-border bg-card/60 p-3 transition-colors hover:border-primary/40"
            >
              <div>
                <p className="font-medium">{item.name}</p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  {item.symbols.join(" · ")}
                </p>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" onClick={() => edit(item)} aria-label={`Edit ${item.name}`}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => void remove(item)} aria-label={`Delete ${item.name}`}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
