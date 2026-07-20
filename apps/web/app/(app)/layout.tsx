import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { AppShell } from "@/components/layout/AppShell";
import type { ExecutionMode, PlanTier } from "@/lib/types";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
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
