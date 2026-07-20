"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { ExecutionMode, RiskSettings } from "@/lib/types";
import { useExecutionStore } from "@/lib/store";

const DEFAULTS: RiskSettings = {
  maxDailyTrades: 5,
  maxDailyLossPercent: 2,
  maxRiskPerTrade: 1,
  killSwitchActive: false,
  executionMode: "manual",
};

const MODE_EXPLANATIONS: Record<ExecutionMode, string> = {
  manual:
    "Sinyaller yalnızca gösterilir; hiçbir emir otomatik gönderilmez. Tam kontrol sizde.",
  one_click:
    "Sinyali siz onaylarsınız, emir tek tıkla brokera iletilir. Onaysız hiçbir şey gönderilmez.",
  full_auto:
    "Onaylı sinyaller, aşağıdaki limitler içinde kaldığı sürece otomatik olarak emre dönüşür.",
};

export function RiskSettingsForm({
  initial,
  onSave,
}: {
  initial?: Partial<RiskSettings>;
  onSave?: (settings: RiskSettings) => void | Promise<void>;
}) {
  const setExecutionMode = useExecutionStore((s) => s.setExecutionMode);
  const [settings, setSettings] = useState<RiskSettings>({ ...DEFAULTS, ...initial });
  const [ack, setAck] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (settings.executionMode === "full_auto" && !ack) {
      setSaved(false);
      setMessage("Tam otomatik mod için risk onayı kutusunu işaretlemeniz gerekiyor.");
      return;
    }
    setSaving(true);
    setMessage(null);
    setSaved(false);
    try {
      if (!onSave) {
        setMessage("Kayıt bağlantısı yok — ayarlar yalnızca bu tarayıcı oturumunda tutuldu.");
      } else {
        await onSave(settings);
        setSaved(true);
        setMessage("Risk ayarları kaydedildi.");
      }
      setExecutionMode(settings.executionMode);
    } catch (err) {
      setMessage((err as Error).message || "Risk ayarları kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card/80 backdrop-blur">
      <div className="border-b border-border/60 px-6 py-5">
        <p className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
          ( Limitler )
        </p>
        <h2 className="mt-2 font-display text-xl font-semibold tracking-tight">
          Limitlerini belirle
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Her limit, otomatik ve tek tık emirlerden önce sunucuda kontrol edilir. Limiti aşan
          emir gönderilmez.
        </p>
      </div>

      <form className="divide-y divide-border/60" onSubmit={handleSubmit}>
        <Field
          index="( 1 )"
          label="Günlük maksimum işlem sayısı"
          help="Bir günde gönderilebilecek toplam emir sayısı. Bu sayıya ulaşıldığında o gün için yeni otomatik emirler reddedilir."
          htmlFor="max-daily-trades"
        >
          <AdornedInput unit="işlem / gün">
            <Input
              id="max-daily-trades"
              type="number"
              min={1}
              max={50}
              className="font-mono"
              value={settings.maxDailyTrades}
              onChange={(e) =>
                setSettings((s) => ({ ...s, maxDailyTrades: Number(e.target.value) }))
              }
            />
          </AdornedInput>
        </Field>

        <Field
          index="( 2 )"
          label="Günlük maksimum zarar"
          help="Günlük zarar, hesap bakiyenizin bu yüzdesine ulaşırsa kill switch otomatik devreye girer: o gün için tüm otomatik işlemler durdurulur ve hesap manuel moda döner."
          htmlFor="max-daily-loss"
        >
          <AdornedInput unit="% bakiye">
            <Input
              id="max-daily-loss"
              type="number"
              min={0.5}
              max={20}
              step={0.1}
              className="font-mono"
              value={settings.maxDailyLossPercent}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  maxDailyLossPercent: Number(e.target.value),
                }))
              }
            />
          </AdornedInput>
        </Field>

        <Field
          index="( 3 )"
          label="İşlem başına maksimum risk"
          help="Tek bir işlemde (giriş ile stop arasındaki mesafede) riske edilebilecek tutarın hesap değerinize oranı. Pozisyon büyüklüğü buna göre hesaplanır; aşan emirler reddedilir."
          htmlFor="max-risk-per-trade"
        >
          <AdornedInput unit="% hesap değeri">
            <Input
              id="max-risk-per-trade"
              type="number"
              min={0.25}
              max={5}
              step={0.25}
              className="font-mono"
              value={settings.maxRiskPerTrade}
              onChange={(e) =>
                setSettings((s) => ({ ...s, maxRiskPerTrade: Number(e.target.value) }))
              }
            />
          </AdornedInput>
        </Field>

        <Field
          index="( 4 )"
          label="İşlem modu"
          help={MODE_EXPLANATIONS[settings.executionMode]}
          htmlFor="execution-mode"
        >
          <Select
            id="execution-mode"
            value={settings.executionMode}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                executionMode: e.target.value as ExecutionMode,
              }))
            }
          >
            <option value="manual">Manuel — sadece sinyal göster</option>
            <option value="one_click">Tek tık — onayla ve gönder</option>
            <option value="full_auto">Tam otomatik — limitler içinde</option>
          </Select>
        </Field>

        <div className="space-y-4 px-6 py-5">
          {settings.executionMode === "full_auto" ? (
            <label className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/5 p-4 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={ack}
                onChange={(e) => setAck(e.target.checked)}
              />
              <span className="leading-relaxed">
                Tam otomatik modun, yukarıdaki limitler içinde kalarak broker hesabımda gerçek
                emirler oluşturabileceğini ve kill switch&apos;in otomasyonu anında
                durduracağını anladım.
              </span>
            </label>
          ) : null}

          {message ? (
            <p className={`text-sm ${saved ? "text-success" : "text-muted-foreground"}`}>
              {message}
            </p>
          ) : null}

          <Button type="submit" disabled={saving}>
            {saving ? "Kaydediliyor…" : "Risk ayarlarını kaydet"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function Field({
  index,
  label,
  help,
  htmlFor,
  children,
}: {
  index: string;
  label: string;
  help: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-4 px-6 py-5 sm:grid-cols-[1fr_240px] sm:items-start">
      <div>
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[11px] text-muted-foreground">{index}</span>
          <Label htmlFor={htmlFor} className="text-sm font-medium">
            {label}
          </Label>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{help}</p>
      </div>
      <div>{children}</div>
    </div>
  );
}

function AdornedInput({ unit, children }: { unit: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1">{children}</div>
      <span className="whitespace-nowrap text-[11px] uppercase tracking-wider text-muted-foreground">
        {unit}
      </span>
    </div>
  );
}
