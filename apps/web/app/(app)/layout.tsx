import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { AppShell } from "@/components/layout/AppShell";
import type { ExecutionMode, PlanTier } from "@/lib/types";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Soft-fail: hung API refresh must not turn every navigation into ISE.
  let session = null;
  try {
    session = await getServerSession(authOptions);
  } catch {
    redirect("/login");
  }
  if (!session?.accessToken) {
    redirect("/login");
  }

  const planTier = (session.user?.planTier as PlanTier | undefined) ?? "free";
  const executionMode =
    (session.user?.executionMode as ExecutionMode | undefined) ?? "manual";

  return (
    <AppShell
      email={session.user?.email}
      token={session.accessToken}
      planTier={planTier}
      executionMode={executionMode}
      killSwitchActive={Boolean(session.user?.killSwitchActive)}
    >
      {children}
    </AppShell>
  );
}
