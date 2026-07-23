"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FadeIn } from "@/components/reactbits/FadeIn";
import { SpotlightCard } from "@/components/reactbits/SpotlightCard";
import { apiClient, networkErrorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type ModelsResponse = Awaited<ReturnType<typeof apiClient.listModels>>;

export default function ModelsPage() {
  const { data: session } = useSession();
  const [data, setData] = useState<ModelsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session?.accessToken) return;
    setError(null);
    try {
      setData(await apiClient.listModels(session.accessToken));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Modeller yüklenemedi");
    }
  }, [session?.accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  async function promote(version: string) {
    if (!session?.accessToken) return;
    const confirmed = window.confirm(
      `${version} modelini aktifleştirmek istediğinize emin misiniz?\n\n` +
        "Bu model kalite kapılarından tekrar geçecek ve başarılı olursa ilgili piyasa rejiminde yeni sinyalleri üretmeye başlayacak.",
    );
    if (!confirmed) return;
    setBusy(version);
    setError(null);
    setNotice(null);
    try {
      const result = await apiClient.promoteModel(session.accessToken, version);
      setNotice(
        result.promoted
          ? `${version} aktifleştirildi ve artık sinyal üretebilir.`
          : `Model aktifleştirilemedi: ${result.gateFailures.join(", ") || "Kalite kapıları geçilemedi."}`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Promote başarısız");
    } finally {
      setBusy(null);
    }
  }

  async function generate() {
    if (!session?.accessToken) return;
    setBusy("generate");
    setError(null);
    setNotice(null);
    try {
      const result = await apiClient.generateSignals(session.accessToken);
      if (result.queued) {
        setNotice(
          "Sinyal üretimi kuyruğa alındı. Birkaç dakika içinde tamamlanır; sayfayı yenileyerek sonuçları kontrol edin.",
        );
      } else {
        setNotice(
          `${result.predictions ?? 0} tahmin kaydedildi, ${result.signalsCreated ?? 0} yeni sinyal oluşturuldu.`,
        );
      }
      await load();
    } catch (err) {
      setError(networkErrorMessage(err, "Sinyal üretimi başarısız"));
    } finally {
      setBusy(null);
    }
  }

  async function resolve() {
    if (!session?.accessToken) return;
    setBusy("resolve");
    setError(null);
    setNotice(null);
    try {
      const result = await apiClient.resolveSignals(session.accessToken);
      setNotice(`${result.resolved} açık sinyal güncel fiyatlarla çözümlendi.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sinyaller çözümlenemedi");
    } finally {
      setBusy(null);
    }
  }

  async function runLifecycle() {
    if (!session?.accessToken) return;
    setBusy("lifecycle");
    setError(null);
    setNotice(null);
    try {
      const result = await apiClient.runModelLifecycle(session.accessToken);
      setNotice(
        `Yaşam döngüsü tamamlandı: ${result.promotions.length} aktivasyon, ` +
          `${result.rollbacks.length} geri alma, ${result.holds?.length ?? 0} gölge takibinde bekleyen, ` +
          `${result.retrains.length} yeniden eğitim.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Yaşam döngüsü çalıştırılamadı");
    } finally {
      setBusy(null);
    }
  }

  const perf = data?.performance;
  const hitRatePercent = perf?.hitRate == null ? null : perf.hitRate * 100;
  const timeline = data?.timeline ?? [];

  return (
    <div className="space-y-6">
      <FadeIn>
        <div>
          <p className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
            ( Model Yönetimi )
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">Modeller</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sinyal üreten makine öğrenmesi modellerini izleyin ve yönetin.
          </p>
        </div>
      </FadeIn>

      {error ? (
        <Card className="rounded-2xl border-destructive/50">
          <CardContent className="py-3 text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : null}
      {notice ? (
        <Card className="rounded-2xl border-success/40">
          <CardContent className="py-3 text-sm text-success">{notice}</CardContent>
        </Card>
      ) : null}

      <FadeIn delay={140}>
      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold tracking-tight">
              Sistem performansı
            </h2>
            <p className="text-sm text-muted-foreground">
              Son sinyallerin kalitesini ve model sağlığını gösterir.
            </p>
          </div>
          <span className="hidden text-[11px] uppercase tracking-[0.3em] text-muted-foreground sm:inline">
            Model → Signal
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="İsabet oranı"
            tooltip="Hedefe ulaşan sinyallerin, hedefe veya stopa ulaşan tüm sinyallere oranıdır."
            value={hitRatePercent == null ? "—" : `${hitRatePercent.toFixed(1)}%`}
            tone={
              hitRatePercent == null
                ? "neutral"
                : hitRatePercent > 55
                  ? "success"
                  : hitRatePercent >= 45
                    ? "warning"
                    : "destructive"
            }
          />
          <Stat
            label="Brier skoru"
            tooltip="Tahmin olasılıklarının kalibrasyonunu ölçer; 0'a yakın değer daha iyidir."
            value={perf?.calibration.brierScore == null ? "—" : perf.calibration.brierScore.toFixed(3)}
            detail={`${perf?.calibration.sampleSize ?? 0} örnek`}
          />
          <Stat
            label="Drift"
            tooltip="Stable normal, watch izlenmesi gereken, alert ise belirgin veri değişimi anlamına gelir."
            value={driftLabel(perf?.drift.level)}
            detail={perf?.drift.score == null ? "Skor yok" : `Skor ${perf.drift.score.toFixed(2)}`}
            tone={driftTone(perf?.drift.level)}
          />
          <Stat
            label="Açık sinyal"
            tooltip="Henüz hedefe, stopa veya sona erme süresine ulaşmamış sinyal sayısıdır."
            value={String(perf?.openSignals ?? "—")}
            detail={`${perf?.resolved ?? 0} çözümlenen`}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Hedefe ulaşan: <span className="font-mono">{perf?.hitTarget ?? "—"}</span> · Stopa
          ulaşan: <span className="font-mono">{perf?.hitStop ?? "—"}</span> · Toplam çözümlenen:{" "}
          <span className="font-mono">{perf?.resolved ?? "—"}</span>
        </p>
      </section>
      </FadeIn>

      <FadeIn delay={180}>
        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-semibold tracking-tight">
                Beklenti vs. gerçek performans
              </h2>
              <p className="text-sm text-muted-foreground">
                Backtest beklentisi ile çözümlenen canlı/simülasyon sinyallerinin
                ortalama getirisini zaman içinde karşılaştırır.
              </p>
            </div>
            <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-0.5 w-5 bg-primary" /> Backtest
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-0.5 w-5 bg-success" /> Gerçek
              </span>
            </div>
          </div>
          <PerformanceTimeline points={timeline} />
        </section>
      </FadeIn>

      <FadeIn delay={200}>
      <Card className="rounded-2xl bg-card/80 backdrop-blur">
        <CardHeader>
          <CardTitle className="text-base">Kayıtlı modeller</CardTitle>
          <CardDescription>
            Yeni eğitimler aday olarak gelir; yalnızca kalite kapılarını geçen modeller aktifleştirilebilir.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {(data?.models ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Henüz kayıtlı model yok. Nightly/weekly retrain veya ML `/train` sonrası burada
              görünür.
            </p>
          ) : (
            data?.models.map((model) => (
              <div
                key={model.version}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card/60 px-4 py-3 transition-colors hover:border-primary/40"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-mono text-sm">{model.version}</p>
                    <Badge
                      variant={
                        model.isActive
                          ? "success"
                          : model.status === "rejected"
                            ? "destructive"
                            : "outline"
                      }
                    >
                      {model.isActive
                        ? "Aktif"
                        : model.status === "rejected"
                          ? "Reddedildi"
                          : "Aday / Shadow"}
                    </Badge>
                    <Badge variant="secondary">{model.regime}</Badge>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Precision <span className="font-mono text-foreground">{(model.precision * 100).toFixed(1)}%</span>
                    {" · "}Expectancy{" "}
                    <span className="font-mono text-foreground">{(model.expectancy * 100).toFixed(2)}%</span>
                    {" · "}Recall <span className="font-mono">{(model.recall * 100).toFixed(1)}%</span>
                    {" · "}Maks. düşüş <span className="font-mono">{(model.maxDrawdown * 100).toFixed(2)}%</span>
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Eğitim örneği: {model.trainingSamples ?? "—"} · Model dosyası:{" "}
                    {model.artifactSha256 ? "doğrulandı" : "kayıtlı değil"}
                  </p>
                  {model.latestPerformance ? (
                    <p className="text-[11px] text-muted-foreground">
                      Canlı örnek: {model.latestPerformance.sampleSize} · İsabet{" "}
                      {model.latestPerformance.hitRate == null
                        ? "—"
                        : `${(model.latestPerformance.hitRate * 100).toFixed(1)}%`}
                      {" · "}Ortalama getiri{" "}
                      {model.latestPerformance.averageReturn == null
                        ? "—"
                        : `${(model.latestPerformance.averageReturn * 100).toFixed(2)}%`}
                    </p>
                  ) : null}
                  {model.shadowSoak ? (
                    <p className="text-[11px] text-muted-foreground">
                      Gölge takip: {Math.floor(model.shadowSoak.soakAgeHours)} /{" "}
                      {data?.soakGates.minSoakHours ?? 72} saat
                      {" · "}Gizli örnek: {model.shadowSoak.resolvedSamples} /{" "}
                      {data?.soakGates.minShadowSamples ?? 20}
                      {" · "}Gölge isabet:{" "}
                      {model.shadowSoak.hitRate == null
                        ? "—"
                        : `${(model.shadowSoak.hitRate * 100).toFixed(1)}%`}
                      {" · "}Açık değerlendirme: {model.shadowSoak.openEvaluations}
                    </p>
                  ) : null}
                  {model.promotionReason ? (
                    <div className={cn(
                      "mt-2 max-w-2xl rounded-lg border px-3 py-2 text-xs",
                      model.status === "rejected"
                        ? "border-destructive/30 bg-destructive/5 text-destructive"
                        : "border-border text-muted-foreground",
                    )}>
                      <span className="font-medium">
                        {model.status === "rejected" ? "Kalite kapısı sonucu: " : "Aktivasyon notu: "}
                      </span>
                      {model.promotionReason}
                    </div>
                  ) : null}
                </div>
                {model.status === "shadow" && !model.isActive ? (
                  <Button
                    size="sm"
                    disabled={busy === model.version}
                    onClick={() => promote(model.version)}
                  >
                    {busy === model.version ? "Aktifleştiriliyor…" : "Aktifleştir"}
                  </Button>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>
      </FadeIn>

      <FadeIn delay={260}>
      <Card className="rounded-2xl bg-card/80 backdrop-blur">
        <CardHeader>
          <CardTitle className="text-base">Sistemi Çalıştır</CardTitle>
          <CardDescription>Otomatik gece işlemlerini gerektiğinde elle başlatın.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <SystemAction
            title="Sinyal Üret"
            description="Aktif modelle güncel piyasa verisinden yeni sinyaller üretir."
            loading={busy === "generate"}
            disabled={busy !== null}
            onClick={generate}
          />
          <SystemAction
            title="Sinyalleri Çözümle"
            description="Açık sinyallerin hedef, stop veya süre sonuçlarını kontrol eder."
            loading={busy === "resolve"}
            disabled={busy !== null}
            onClick={resolve}
          />
          <SystemAction
            title="Yaşam Döngüsünü Çalıştır"
            description="Şampiyon ve aday modelleri karşılaştırıp drift kontrolü yapar."
            loading={busy === "lifecycle"}
            disabled={busy !== null}
            onClick={runLifecycle}
          />
        </CardContent>
      </Card>
      </FadeIn>
    </div>
  );
}

function PerformanceTimeline({ points }: { points: ModelsResponse["timeline"] }) {
  const usable = points.filter((point) => point.actualReturn != null).slice(-40);
  if (usable.length === 0) {
    return (
      <div className="flex min-h-56 items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 px-6 text-center text-sm text-muted-foreground">
        Zaman serisi, sinyaller çözümlendikçe oluşur. İlk performans snapshot’ından sonra
        backtest ve gerçek sonuç çizgileri burada görünecek.
      </div>
    );
  }

  const width = 900;
  const height = 250;
  const padding = 28;
  const values = usable.flatMap((point) => [
    point.expectedReturn,
    point.actualReturn ?? 0,
  ]);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const spread = Math.max(max - min, 0.001);
  const x = (index: number) =>
    padding +
    (index / Math.max(usable.length - 1, 1)) * (width - padding * 2);
  const y = (value: number) =>
    height - padding - ((value - min) / spread) * (height - padding * 2);
  const expectedPath = usable
    .map((point, index) => `${x(index)},${y(point.expectedReturn)}`)
    .join(" ");
  const actualPath = usable
    .map((point, index) => `${x(index)},${y(point.actualReturn ?? 0)}`)
    .join(" ");

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card/70 p-4 backdrop-blur">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Backtest beklentisi ve gerçek performans zaman grafiği"
        className="h-64 w-full"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const lineY = padding + ratio * (height - padding * 2);
          return (
            <line
              key={ratio}
              x1={padding}
              x2={width - padding}
              y1={lineY}
              y2={lineY}
              className="stroke-border/60"
              strokeWidth="1"
            />
          );
        })}
        <line
          x1={padding}
          x2={width - padding}
          y1={y(0)}
          y2={y(0)}
          className="stroke-muted-foreground/50"
          strokeDasharray="4 6"
        />
        <polyline
          points={expectedPath}
          fill="none"
          className="stroke-primary"
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <polyline
          points={actualPath}
          fill="none"
          className="stroke-success"
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {usable.map((point, index) => (
          <g key={`${point.modelVersion}-${point.calculatedAt}`}>
            <circle
              cx={x(index)}
              cy={y(point.actualReturn ?? 0)}
              r="4"
              className="fill-success stroke-background"
              strokeWidth="2"
            >
              <title>
                {new Date(point.calculatedAt).toLocaleDateString("tr-TR")} · Gerçek{" "}
                {((point.actualReturn ?? 0) * 100).toFixed(2)}% · Backtest{" "}
                {(point.expectedReturn * 100).toFixed(2)}% · {point.sampleSize} örnek
              </title>
            </circle>
          </g>
        ))}
      </svg>
      <div className="flex justify-between text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        <span>{new Date(usable[0].calculatedAt).toLocaleDateString("tr-TR")}</span>
        <span>{usable.length} snapshot</span>
        <span>
          {new Date(usable[usable.length - 1].calculatedAt).toLocaleDateString("tr-TR")}
        </span>
      </div>
    </div>
  );
}

type Tone = "neutral" | "success" | "warning" | "destructive";

function Stat({
  label,
  tooltip,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  tooltip: string;
  value: string;
  detail?: string;
  tone?: Tone;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card/80 p-5 backdrop-blur">
      <div className="flex items-center gap-1.5">
        <p className="text-[11px] uppercase tracking-widest text-muted-foreground">{label}</p>
        <span
          className="cursor-help text-xs text-muted-foreground"
          title={tooltip}
          aria-label={tooltip}
        >
          ⓘ
        </span>
      </div>
      <p
        className={cn(
          "mt-2 font-mono text-2xl font-semibold",
          tone === "success" && "text-success",
          tone === "warning" && "text-warning",
          tone === "destructive" && "text-destructive",
        )}
      >
        {value}
      </p>
      {detail ? <p className="mt-1 text-[11px] text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

function SystemAction({
  title,
  description,
  loading,
  disabled,
  onClick,
}: {
  title: string;
  description: string;
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <SpotlightCard className="rounded-xl">
      <div className="flex h-full flex-col justify-between gap-3 p-4">
        <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
        <Button variant="outline" disabled={disabled} onClick={onClick}>
          {loading ? "Çalışıyor…" : title}
        </Button>
      </div>
    </SpotlightCard>
  );
}

function driftLabel(level?: ModelsResponse["performance"]["drift"]["level"]) {
  if (level === "stable") return "Stable";
  if (level === "watch") return "Watch";
  if (level === "alert") return "Alert";
  if (level === "insufficient_data") return "Yetersiz veri";
  return "—";
}

function driftTone(level?: ModelsResponse["performance"]["drift"]["level"]): Tone {
  if (level === "stable") return "success";
  if (level === "watch") return "warning";
  if (level === "alert") return "destructive";
  return "neutral";
}
