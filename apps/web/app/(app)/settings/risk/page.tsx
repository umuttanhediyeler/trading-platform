"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { ShieldCheck, Gauge, OctagonX } from "lucide-react";
import { RiskSettingsForm } from "@/components/risk/RiskSettingsForm";
import { FadeIn } from "@/components/reactbits/FadeIn";
import { SpotlightCard } from "@/components/reactbits/SpotlightCard";
import { Badge } from "@/components/ui/badge";
import { apiClient } from "@/lib/api-client";
import { useExecutionStore } from "@/lib/store";
import type { RiskSettings } from "@/lib/types";

const DEFENSE_LINES = [
  {
    no: "( 1 )",
    icon: ShieldCheck,
    title: "Emir öncesi kontrol",
    body: "Her emir gönderilmeden önce işlem başına risk ve toplam pozisyon büyüklüğü sunucuda doğrulanır. Limiti aşan emir brokera hiç ulaşmaz.",
  },
  {
    no: "( 2 )",
    icon: Gauge,
    title: "Günlük limitler",
    body: "İşlem sayısı ve zarar, gün boyunca sürekli izlenir. Günlük zarar limitine ulaşıldığında otomasyon o gün için kendiliğinden durur.",
  },
  {
    no: "( 3 )",
    icon: OctagonX,
    title: "Kill switch",
    body: "Acil durdurma düğmesi: bekleyen emirleri iptal eder, otomasyonu anında keser ve hesabı manuel moda alır. Üst bardan her ekranda erişilebilir.",
  },
];

export default function RiskSettingsPage() {
  const { data: session } = useSession();
  const token = session?.accessToken;
  const setStoreMode = useExecutionStore((s) => s.setExecutionMode);
  const setStoreKill = useExecutionStore((s) => s.setKillSwitchActive);
  const [initial, setInitial] = useState<Partial<RiskSettings> | undefined>();
  const [loading, setLoading] = useState(true);
  const [killSwitchActive, setKillSwitchActive] = useState(false);
  const [killSwitchReason, setKillSwitchReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const me = await apiClient.me(token);
        if (cancelled) return;
        const killOn = Boolean(me.riskSettings?.killSwitchActive);
        setKillSwitchActive(killOn);
        setKillSwitchReason(me.riskSettings?.killSwitchReason ?? null);
        setStoreKill(killOn);
        if (
          me.executionMode === "manual" ||
          me.executionMode === "one_click" ||
          me.executionMode === "full_auto"
        ) {
          setStoreMode(me.executionMode);
        }
        setInitial({
          maxDailyTrades: me.riskSettings?.maxDailyTrades,
          maxDailyLossPercent: me.riskSettings?.maxDailyLossPercent,
          maxRiskPerTrade: me.riskSettings?.maxRiskPerTrade,
          killSwitchActive: killOn,
          executionMode: me.executionMode as RiskSettings["executionMode"],
        });
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, setStoreKill, setStoreMode]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <FadeIn>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
              ( Güvenlik )
            </p>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">
              Risk Kontrolleri
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Otomatik işlemlerin asla aşamayacağı sınırları buradan belirlersiniz.
            </p>
          </div>
          <Badge variant={killSwitchActive ? "destructive" : "success"}>
            {killSwitchActive ? "Kill switch aktif — işlemler durdu" : "Koruma devrede"}
          </Badge>
        </div>
      </FadeIn>

      {killSwitchActive ? (
        <FadeIn>
          <div
            role="alert"
            className="rounded-2xl border border-destructive/40 bg-destructive/10 px-5 py-4 text-sm"
          >
            <p className="font-semibold text-destructive">
              Kill switch açık — hesap manuel moda alındı
            </p>
            <p className="mt-1.5 text-muted-foreground">
              {killSwitchReason
                ? `Sebep: ${killSwitchReason}`
                : "Otomasyon durduruldu. Full auto’yu tekrar kaydederseniz kill switch kapanır ve otomasyon yeniden açılır."}
            </p>
          </div>
        </FadeIn>
      ) : null}

      <FadeIn delay={60}>
        <div className="rounded-2xl border border-border bg-card/80 p-6 backdrop-blur">
          <p className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
            Bu sayfa nedir?
          </p>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Risk kontrolleri, otomatik ve manuel emirlerin önünde duran{" "}
            <span className="text-foreground">son savunma hattıdır</span>. Aşağıda
            belirlediğiniz limitler her emirden önce sunucuda kontrol edilir; bir limit
            aşılırsa emir <span className="text-foreground">reddedilir</span> ve brokera hiç
            iletilmez. Günlük zarar limitine ulaşılırsa kill switch kendiliğinden devreye girer
            ve <span className="text-foreground">her şeyi durdurur</span> — bekleyen emirler
            iptal edilir, hesap manuel moda döner. Kill switch&apos;e üst bardan her an
            manuel olarak da basabilirsiniz.
          </p>
        </div>
      </FadeIn>

      <FadeIn delay={120}>
        <div className="grid gap-3 sm:grid-cols-3">
          {DEFENSE_LINES.map((line) => (
            <SpotlightCard key={line.no} className="rounded-2xl">
              <div className="p-5">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-muted-foreground">{line.no}</span>
                  <line.icon className="h-4 w-4 text-primary" aria-hidden />
                </div>
                <h3 className="mt-4 font-display text-base font-semibold tracking-tight">
                  {line.title}
                </h3>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{line.body}</p>
              </div>
            </SpotlightCard>
          ))}
        </div>
      </FadeIn>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <FadeIn delay={180}>
        <RiskSettingsForm
          initial={initial}
          loading={loading}
          onSave={async (settings) => {
            if (!token) throw new Error("Oturum gerekli — tekrar giriş yapın.");
            try {
              const modeResult = await apiClient.setExecutionMode(
                token,
                settings.executionMode,
                settings.executionMode === "full_auto",
              );
              setStoreMode(
                modeResult.executionMode as RiskSettings["executionMode"],
              );
              if (typeof modeResult.killSwitchActive === "boolean") {
                setStoreKill(modeResult.killSwitchActive);
                setKillSwitchActive(modeResult.killSwitchActive);
                if (!modeResult.killSwitchActive) setKillSwitchReason(null);
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : "İşlem modu kaydedilemedi";
              throw new Error(
                `${msg}. Broker bağlantısı ve Premium plan gerekli olabilir; limitler henüz kaydedilmedi.`,
              );
            }
            await apiClient.updateRisk(token, settings);
            const me = await apiClient.me(token);
            const killOn = Boolean(me.riskSettings?.killSwitchActive);
            setKillSwitchActive(killOn);
            setKillSwitchReason(me.riskSettings?.killSwitchReason ?? null);
            setStoreKill(killOn);
            if (
              me.executionMode === "manual" ||
              me.executionMode === "one_click" ||
              me.executionMode === "full_auto"
            ) {
              setStoreMode(me.executionMode);
            }
            setInitial({
              ...settings,
              killSwitchActive: killOn,
              executionMode: me.executionMode as RiskSettings["executionMode"],
            });
          }}
        />
      </FadeIn>
    </div>
  );
}
