"use client";

import { useEffect, useRef, useState } from "react";
import { ShieldAlert, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useExecutionStore } from "@/lib/store";
import { apiClient } from "@/lib/api-client";
import { cn } from "@/lib/utils";

export function KillSwitchButton({
  token,
  className,
}: {
  token?: string | null;
  className?: string;
}) {
  const killSwitchActive = useExecutionStore((s) => s.killSwitchActive);
  const setKillSwitchActive = useExecutionStore((s) => s.setKillSwitchActive);
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Close the confirm popover on outside click or Escape.
  useEffect(() => {
    if (!confirming) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setConfirming(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setConfirming(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [confirming]);

  async function setActive(next: boolean) {
    if (!token) return;
    const previous = killSwitchActive;
    setPending(true);
    setConfirming(false);
    setKillSwitchActive(next);
    try {
      await apiClient.killSwitch(token, next);
    } catch {
      setKillSwitchActive(previous);
    } finally {
      setPending(false);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <Button
        type="button"
        variant={killSwitchActive ? "success" : "destructive"}
        size="sm"
        className={cn("font-semibold tracking-wide", className)}
        onClick={() => {
          // Deactivation is safe; activation is destructive (cancels all open
          // broker orders), so it always requires an explicit confirm step.
          if (killSwitchActive) {
            void setActive(false);
          } else {
            setConfirming((v) => !v);
          }
        }}
        disabled={pending || !token}
        aria-pressed={killSwitchActive}
        title="Acil durdurma: otomasyonu keser ve tüm açık broker emirlerini iptal eder"
      >
        {killSwitchActive ? (
          <>
            <ShieldOff className="h-4 w-4" />
            Kill switch ON
          </>
        ) : (
          <>
            <ShieldAlert className="h-4 w-4" />
            Kill switch
          </>
        )}
      </Button>
      {confirming ? (
        <div
          role="alertdialog"
          aria-label="Kill switch onayı"
          className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-border bg-popover p-3 shadow-lg"
        >
          <p className="text-sm font-semibold text-destructive">
            Acil durdurma etkinleştirilsin mi?
          </p>
          <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
            Otomatik işlem durur, işlem modunuz manuele döner ve brokerdaki{" "}
            <strong>tüm açık/bekleyen emirler iptal edilir</strong>.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfirming(false)}
            >
              Vazgeç
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={pending}
              onClick={() => void setActive(true)}
            >
              Evet, durdur
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
