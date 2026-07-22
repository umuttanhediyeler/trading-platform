"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import type { ScanDefinition, ScanTemplate } from "@trading-platform/shared-types";
import { ScanBuilder } from "@/components/scanner/ScanBuilder";
import { ScanResultsTable } from "@/components/scanner/ScanResultsTable";
import { WatchlistManager } from "@/components/scanner/WatchlistManager";
import { LiveChart } from "@/components/charts/LiveChart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ErrorState, LoadingBlock } from "@/components/shared/states";
import { FadeIn } from "@/components/reactbits/FadeIn";
import { apiClient } from "@/lib/api-client";
import { DEMO_SCAN_ROWS } from "@/lib/demo-data";
import { useExecutionStore } from "@/lib/store";
import { onWsEvent, connectSocket } from "@/lib/ws-client";
import type { FilterDSL, ScanRow } from "@/lib/types";

export default function ScannerPage() {
  const { data: session } = useSession();
  const token = session?.accessToken;
  const planTier = useExecutionStore((s) => s.planTier);
  const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
  const [rows, setRows] = useState<ScanRow[]>(demoMode ? DEMO_SCAN_ROWS : []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ScanRow | null>(
    demoMode ? DEMO_SCAN_ROWS[0] ?? null : null,
  );
  const [liveNote, setLiveNote] = useState("Tarama çalıştırın — sonuçlar canlı veriden gelir");
  const [scans, setScans] = useState<ScanDefinition[]>([]);
  const [templates, setTemplates] = useState<ScanTemplate[]>([]);
  const [selectedScanId, setSelectedScanId] = useState<string>("");
  const [scanName, setScanName] = useState("Yeni tarama");
  const [dsl, setDsl] = useState<FilterDSL>({
    operator: "AND",
    conditions: [{ field: "volume_ratio", op: ">", value: 3 }],
  });
  const [loadingDefinitions, setLoadingDefinitions] = useState(true);
  const [hasRun, setHasRun] = useState(demoMode);

  const loadDefinitions = useCallback(async () => {
    if (!token) return;
    setLoadingDefinitions(true);
    setError(null);
    try {
      const [saved, availableTemplates] = await Promise.all([
        apiClient.listScans(token),
        apiClient.scanTemplates(token),
      ]);
      setScans(saved);
      setTemplates(availableTemplates);
      if (saved[0]) {
        setSelectedScanId(saved[0].id);
        setScanName(saved[0].name);
        setDsl(saved[0].filterDSL);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Saved scans could not be loaded");
    } finally {
      setLoadingDefinitions(false);
    }
  }, [token]);

  useEffect(() => {
    if (token) void loadDefinitions();
    else setLoadingDefinitions(false);
  }, [loadDefinitions, token]);

  useEffect(() => {
    connectSocket(token);
    return onWsEvent("scan:result", (payload) => {
      if (selectedScanId && payload.scanId !== selectedScanId) return;
      setRows(payload.rows);
      setHasRun(true);
      setSelected(payload.rows[0] ?? null);
      setLiveNote(`Canlı push · ${payload.rows.length} sonuç`);
      setLoading(false);
    });
  }, [selectedScanId, token]);

  async function persistScan(nextDsl: FilterDSL) {
    if (!token) throw new Error("Oturum bulunamadı — lütfen tekrar giriş yapın.");
    const scan = selectedScanId
      ? await apiClient.updateScan(token, selectedScanId, scanName, nextDsl)
      : await apiClient.createScan(token, scanName, nextDsl);
      setSelectedScanId(scan.id);
      setDsl(scan.filterDSL);
      setScans((current) => {
        const without = current.filter(({ id }) => id !== scan.id);
        return [scan, ...without];
      });
    return scan;
  }

  async function saveScan() {
    setError(null);
    try {
      await persistScan(dsl);
      setLiveNote("Tarama kaydedildi");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan could not be saved");
    }
  }

  async function runScan(nextDsl: FilterDSL) {
    setLoading(true);
    setError(null);

    try {
      if (!token) throw new Error("Oturum bulunamadı — lütfen tekrar giriş yapın.");
      const scan = await persistScan(nextDsl);
      const result = await apiClient.runScan(token, scan.id);
      setRows(result.rows);
      setHasRun(true);
      setSelected(result.rows[0] ?? null);
      setLiveNote(`Canlı tarama · ${result.rows.length} sonuç`);
    } catch (err) {
      if (demoMode) {
        setRows(DEMO_SCAN_ROWS);
        setSelected(DEMO_SCAN_ROWS[0] ?? null);
        setLiveNote("Demo satırlar (API erişilemedi)");
      } else {
        setError(err instanceof Error ? err.message : "Tarama çalıştırılamadı");
      }
    } finally {
      setLoading(false);
    }
  }

  function selectScan(id: string) {
    setSelectedScanId(id);
    const scan = scans.find((item) => item.id === id);
    if (scan) {
      setScanName(scan.name);
      setDsl(scan.filterDSL);
      setRows([]);
      setHasRun(false);
      setSelected(null);
      setLiveNote("Kayıtlı tarama seçildi — güncel sonuçlar için çalıştırın");
    }
  }

  function newScan() {
    setSelectedScanId("");
    setScanName("Yeni tarama");
    setDsl({ operator: "AND", conditions: [{ field: "volume_ratio", op: ">", value: 3 }] });
    setRows([]);
    setHasRun(false);
    setSelected(null);
  }

  async function deleteScan() {
    if (!token || !selectedScanId || !window.confirm(`Delete “${scanName}”?`)) return;
    try {
      await apiClient.deleteScan(token, selectedScanId);
      const remaining = scans.filter(({ id }) => id !== selectedScanId);
      setScans(remaining);
      newScan();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan could not be deleted");
    }
  }

  return (
    <div className="space-y-6">
      <FadeIn>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
              Scan → Signal → Simulate
            </p>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">Scanner</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Hazır fikirlerden başlayın, koşulları düzenleyin ve binlerce hisseyi tek
              tıkla tarayın.
            </p>
          </div>
          <Badge variant="outline">{liveNote}</Badge>
        </div>
      </FadeIn>

      {loadingDefinitions ? (
        <LoadingBlock rows={2} />
      ) : (
        <FadeIn delay={80} className="space-y-4">
          <div className="grid gap-2 rounded-2xl border border-border bg-card/80 p-3 backdrop-blur md:grid-cols-[1fr_1fr_auto_auto_auto]">
            <Select
              value={selectedScanId}
              onChange={(event) => selectScan(event.target.value)}
              aria-label="Kayıtlı tarama"
            >
              <option value="">Yeni tarama</option>
              {scans.map((scan) => (
                <option key={scan.id} value={scan.id}>{scan.name}</option>
              ))}
            </Select>
            <Input
              value={scanName}
              onChange={(event) => setScanName(event.target.value)}
              placeholder="Tarama adı"
              aria-label="Tarama adı"
            />
            <Button variant="outline" onClick={newScan}>Yeni</Button>
            <Button
              variant="outline"
              onClick={() => void saveScan()}
              disabled={!scanName.trim()}
            >
              Kaydet
            </Button>
            <Button
              variant="outline"
              onClick={() => void deleteScan()}
              disabled={!selectedScanId}
            >
              Sil
            </Button>
          </div>
          <ScanBuilder
            initial={dsl}
            planTier={planTier}
            templates={templates}
            onChange={setDsl}
            onRun={runScan}
            disabled={loading || !scanName.trim()}
          />
        </FadeIn>
      )}

      {error ? (
        <ErrorState
          title="Tarama başarısız"
          description={error}
          onRetry={() => setError(null)}
        />
      ) : (
        <FadeIn delay={140}>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
            <ScanResultsTable
              rows={rows}
              loading={loading}
              hasRun={hasRun}
              selectedSymbol={selected?.symbol}
              onSelect={setSelected}
            />
            <div className="space-y-2">
              <h2 className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
                Hisse Grafiği
              </h2>
              <LiveChart symbol={selected?.symbol} height={300} />
            </div>
          </div>
        </FadeIn>
      )}

      <FadeIn delay={200}>
        <WatchlistManager token={token} />
      </FadeIn>
    </div>
  );
}
