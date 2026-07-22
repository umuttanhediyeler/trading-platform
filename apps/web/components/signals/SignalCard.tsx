"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SpotlightCard } from "@/components/reactbits/SpotlightCard";
import { SymbolWithLogo } from "@/components/shared/StockLogo";
import { SignalConfidenceBadge } from "./SignalConfidenceBadge";
import { apiClient } from "@/lib/api-client";
import { hasEntitlement } from "@/lib/entitlements";
import { useExecutionStore } from "@/lib/store";
import type { Signal } from "@/lib/types";
import { inferSignalSide, strategyLabel } from "@/lib/strategy-labels";
import { formatNumber } from "@/lib/utils";

interface SignalCardProps {
  signal: Signal;
  token?: string;
  broker: { broker: string; mode: "paper" | "live"; connectedAt: string } | null;
  maxRiskPerTrade: number | null;
  /** When false, the one-click order action is hidden (read-only card). */
  showOrderAction?: boolean;
}

export function SignalCard({
  signal,
  token,
  broker,
  maxRiskPerTrade,
  showOrderAction = true,
}: SignalCardProps) {
  const generated = new Date(signal.generatedAt);
  const status = signalStatus(signal.status);
  const side =
    signal.side === "buy" || signal.side === "sell"
      ? signal.side
      : inferSignalSide(signal.entryPrice, signal.stopPrice, signal.targetPrice);
  const isShort = side === "sell";
  const planTier = useExecutionStore((state) => state.planTier);
  const killSwitchActive = useExecutionStore((state) => state.killSwitchActive);
  const [quantity, setQuantity] = useState(1);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const entitled = hasEntitlement(planTier, "one_click_trade");
  const estimatedNotional = signal.entryPrice * quantity;
  const estimatedStopRisk = Math.abs(signal.entryPrice - signal.stopPrice) * quantity;

  const blockedReason = killSwitchActive
    ? "Kill switch is active"
    : !entitled
      ? "Basic or Premium plan required"
      : !broker
        ? "Connect a broker in Settings"
        : !token
          ? "Sign in again to trade"
          : null;

  async function submitOrder() {
    if (!token || !broker || blockedReason) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const order = await apiClient.placeBrokerOrder(token, {
        symbol: signal.symbol,
        side,
        quantity,
        type: "market",
        clientOrderId: `oc-${signal.id}`,
      });
      setSuccess(`Order ${order.status} · ${order.quantity} ${order.symbol}`);
      setConfirming(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Order could not be submitted");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SpotlightCard className="rounded-2xl">
      <div className="p-5 pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <SymbolWithLogo symbol={signal.symbol} size="md" symbolClassName="text-lg" />
            <p className="mt-1 text-xs text-muted-foreground">{strategyLabel(signal.strategyId)}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Badge
              variant={isShort ? "destructive" : "success"}
              className="font-mono"
            >
              {isShort ? "SAT / SHORT" : "AL / LONG"}
            </Badge>
            <SignalConfidenceBadge confidence={signal.confidence} />
            <Badge variant={status.variant}>{status.label}</Badge>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 p-5 pt-3 text-sm">
        <Metric label="Entry" value={formatNumber(signal.entryPrice)} />
        <Metric
          label={isShort ? "Stop (üst)" : "Stop"}
          value={formatNumber(signal.stopPrice)}
          tone="destructive"
        />
        <Metric
          label={isShort ? "Target (alt)" : "Target"}
          value={formatNumber(signal.targetPrice)}
          tone="success"
        />
        {signal.realizedReturn != null ? (
          <p
            className={`col-span-3 font-mono text-xs ${
              signal.realizedReturn >= 0 ? "text-success" : "text-destructive"
            }`}
          >
            Gerçekleşen getiri {(signal.realizedReturn * 100).toFixed(2)}%
            {signal.resolvedPrice != null
              ? ` · ${formatNumber(signal.resolvedPrice)} fiyatında kapandı`
              : ""}
          </p>
        ) : null}
        <p className="col-span-3 text-xs text-muted-foreground">
          Üretildi {generated.toLocaleString("tr-TR")}
          {signal.modelVersion ? ` · ${signal.modelVersion}` : ""}
        </p>
      </div>
      {showOrderAction && signal.status === "open" ? (
        <div className="space-y-3 border-t border-border p-5">
          {!confirming ? (
            <div className="space-y-2">
              <Button
                type="button"
                size="sm"
                className="w-full"
                disabled={Boolean(blockedReason) || Boolean(success)}
                onClick={() => {
                  setError(null);
                  setConfirming(true);
                }}
              >
                {success ? "Order submitted" : "Review one-click order"}
              </Button>
              {blockedReason ? (
                <p className="text-xs text-warning" role="status">
                  {blockedReason}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="space-y-3 rounded-xl border border-border bg-background/60 p-3">
              <div className="flex items-center justify-between gap-2">
                <strong className="text-sm">
                  Confirm market {isShort ? "sell" : "buy"}
                </strong>
                <Badge variant={broker?.mode === "live" ? "destructive" : "warning"}>
                  {broker?.mode === "live" ? "LIVE MONEY" : "PAPER"}
                </Badge>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`quantity-${signal.id}`}>Quantity</Label>
                <Input
                  id={`quantity-${signal.id}`}
                  type="number"
                  min={1}
                  max={100000}
                  step={1}
                  value={quantity}
                  disabled={submitting}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    setQuantity(Number.isInteger(next) && next > 0 ? Math.min(next, 100000) : 1);
                  }}
                />
              </div>
              <dl className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <dt className="text-muted-foreground">Est. notional</dt>
                  <dd className="font-mono">{formatNumber(estimatedNotional)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Loss at signal stop</dt>
                  <dd className="font-mono text-destructive">
                    {formatNumber(estimatedStopRisk)}
                  </dd>
                </div>
              </dl>
              <p className="text-xs leading-5 text-muted-foreground">
                This submits a market order to {broker?.broker}. The signal stop is an estimate,
                not an attached stop order. Server kill-switch and daily-trade checks apply
                {maxRiskPerTrade == null
                  ? "."
                  : `; your configured per-trade risk cap is ${maxRiskPerTrade}%.`}
              </p>
              {broker?.mode === "live" ? (
                <p className="text-xs font-medium text-destructive" role="alert">
                  Live orders can execute immediately and create real financial loss.
                </p>
              ) : (
                <p className="text-xs text-warning">
                  Paper order: no real funds will be used.
                </p>
              )}
              {killSwitchActive ? (
                <p className="text-xs text-destructive" role="alert">
                  Kill switch activated. Submission is blocked.
                </p>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={submitting}
                  onClick={() => setConfirming(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant={broker?.mode === "live" ? "destructive" : "default"}
                  size="sm"
                  disabled={submitting || Boolean(blockedReason)}
                  onClick={() => void submitOrder()}
                >
                  {submitting
                    ? "Submitting…"
                    : broker?.mode === "live"
                      ? "Submit LIVE order"
                      : "Submit paper order"}
                </Button>
              </div>
            </div>
          )}
          {error ? (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          {success ? (
            <p className="text-xs text-success" role="status">
              {success}
            </p>
          ) : null}
        </div>
      ) : null}
    </SpotlightCard>
  );
}

function signalStatus(status: Signal["status"]): {
  label: string;
  variant: "outline" | "success" | "destructive" | "warning";
} {
  if (status === "hit_target") return { label: "Hedefe ulaştı", variant: "success" };
  if (status === "hit_stop") return { label: "Stop oldu", variant: "destructive" };
  if (status === "expired") return { label: "Süresi doldu", variant: "warning" };
  return { label: "Açık", variant: "outline" };
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "destructive";
}) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p
        className={
          tone === "success"
            ? "mt-1 font-mono text-success"
            : tone === "destructive"
              ? "mt-1 font-mono text-destructive"
              : "mt-1 font-mono"
        }
      >
        {value}
      </p>
    </div>
  );
}
