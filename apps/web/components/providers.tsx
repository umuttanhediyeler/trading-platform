"use client";

import { SessionProvider } from "next-auth/react";

export function Providers({ children }: { children: React.ReactNode }) {
  // Access tokens last 30m–2h; refresh only on a calm interval.
  // Window-focus refetch stampeded /api/auth/session during navigation.
  return (
    <SessionProvider refetchInterval={10 * 60} refetchOnWindowFocus={false}>
      {children}
    </SessionProvider>
  );
}
