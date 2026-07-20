"use client";

import { create } from "zustand";
import type { ExecutionMode, PlanTier } from "./types";

interface ExecutionState {
  planTier: PlanTier;
  executionMode: ExecutionMode;
  killSwitchActive: boolean;
  theme: "dark" | "light";
  setPlanTier: (tier: PlanTier) => void;
  setExecutionMode: (mode: ExecutionMode) => void;
  setKillSwitchActive: (active: boolean) => void;
  toggleTheme: () => void;
}

export const useExecutionStore = create<ExecutionState>((set) => ({
  planTier: "free",
  executionMode: "manual",
  killSwitchActive: false,
  theme: "dark",
  setPlanTier: (planTier) => set({ planTier }),
  setExecutionMode: (executionMode) => set({ executionMode }),
  setKillSwitchActive: (killSwitchActive) => set({ killSwitchActive }),
  toggleTheme: () =>
    set((state) => {
      const theme = state.theme === "dark" ? "light" : "dark";
      if (typeof document !== "undefined") {
        document.documentElement.classList.toggle("light", theme === "light");
        document.documentElement.classList.toggle("dark", theme === "dark");
      }
      return { theme };
    }),
}));
