"use client";

import { useEffect, useRef } from "react";
import { Sidebar, MobileNav } from "./Sidebar";
import { Topbar } from "./Topbar";
import { useExecutionStore } from "@/lib/store";
import { apiClient } from "@/lib/api-client";
import { connectSocket, disconnectSocket, onWsEvent } from "@/lib/ws-client";
import type { PlanTier, ExecutionMode } from "@/lib/types";

export function AppShell({
  children,
  email,
  token,
  planTier,
  executionMode,
  killSwitchActive,
}: {
  children: React.ReactNode;
  email?: string | null;
  token?: string | null;
  planTier?: PlanTier;
  executionMode?: ExecutionMode;
  killSwitchActive?: boolean;
}) {
  const setPlanTier = useExecutionStore((s) => s.setPlanTier);
  const setExecutionMode = useExecutionStore((s) => s.setExecutionMode);
  const setKillSwitchActive = useExecutionStore((s) => s.setKillSwitchActive);
  /** After /users/me syncs, ignore stale NextAuth session props. */
  const liveSynced = useRef(false);

  useEffect(() => {
    if (liveSynced.current) return;
    if (planTier) setPlanTier(planTier);
    if (executionMode) setExecutionMode(executionMode);
    if (typeof killSwitchActive === "boolean") setKillSwitchActive(killSwitchActive);
  }, [
    planTier,
    executionMode,
    killSwitchActive,
    setPlanTier,
    setExecutionMode,
    setKillSwitchActive,
  ]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    liveSynced.current = false;
    apiClient
      .me(token)
      .then((profile) => {
        if (cancelled) return;
        const tier = profile.plan?.tier;
        if (tier === "free" || tier === "basic" || tier === "premium") {
          setPlanTier(tier);
        }
        if (
          profile.executionMode === "manual" ||
          profile.executionMode === "one_click" ||
          profile.executionMode === "full_auto"
        ) {
          setExecutionMode(profile.executionMode);
        }
        setKillSwitchActive(Boolean(profile.riskSettings?.killSwitchActive));
        liveSynced.current = true;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [token, setPlanTier, setExecutionMode, setKillSwitchActive]);

  useEffect(() => {
    connectSocket(token);
    const off = onWsEvent("execution:kill-switch-triggered", () => {
      setKillSwitchActive(true);
      setExecutionMode("manual");
    });
    return () => {
      off();
      disconnectSocket();
    };
  }, [token, setKillSwitchActive, setExecutionMode]);

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar email={email} token={token} planTier={planTier} />
        <main className="flex-1 overflow-auto p-4 pb-20 lg:p-6 lg:pb-6">{children}</main>
        <MobileNav />
      </div>
    </div>
  );
}
