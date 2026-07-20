import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PLAN_FEATURES } from "@/lib/types";
import { cn } from "@/lib/utils";

const PLANS = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    blurb: "Delayed data, capped filters, simulation only.",
  },
  {
    id: "basic",
    name: "Basic",
    price: "$29",
    blurb: "Unlimited filters, limited backtest, one-click + broker.",
  },
  {
    id: "premium",
    name: "Premium",
    price: "$79",
    blurb: "AI signals, unlimited backtest, full auto with risk gates.",
  },
] as const;

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="flex items-center justify-between gap-4">
          <div>
            <Link href="/" className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Apex Scan
            </Link>
            <h1 className="mt-2 text-3xl font-semibold">Pricing</h1>
            <p className="mt-2 text-muted-foreground">
              Stripe checkout is wired through the API when billing endpoints are live.
            </p>
          </div>
          <Link href="/register" className={cn(buttonVariants())}>
            Start free
          </Link>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {PLANS.map((plan) => (
            <Card key={plan.id} className={plan.id === "premium" ? "border-primary/50" : undefined}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{plan.name}</CardTitle>
                  {plan.id === "premium" ? <Badge>Most capable</Badge> : null}
                </div>
                <CardDescription>{plan.blurb}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="font-mono text-3xl font-semibold">
                  {plan.price}
                  <span className="text-sm text-muted-foreground">/mo</span>
                </p>
                <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                  {PLAN_FEATURES.slice(0, 5).map((f) => (
                    <li key={f.feature}>
                      {f.feature}:{" "}
                      <span className="font-mono text-foreground">
                        {String(f[plan.id as "free" | "basic" | "premium"])}
                      </span>
                    </li>
                  ))}
                </ul>
                <Link
                  href="/register"
                  className={cn(buttonVariants({ className: "mt-6 w-full" }))}
                >
                  Choose {plan.name}
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
