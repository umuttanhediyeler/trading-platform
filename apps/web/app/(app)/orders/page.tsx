"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SpotlightCard } from "@/components/reactbits/SpotlightCard";
import { CountUp } from "@/components/reactbits/CountUp";
import { FadeIn } from "@/components/reactbits/FadeIn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState, LoadingBlock } from "@/components/shared/states";
import { ApiError, apiClient } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { BrokerOrderLedgerEntry } from "@/lib/types";
import { RefreshCw } from "lucide-react";

function MicroLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{children}</p>
  );
}

function sourceBadge(source: string) {
  if (source === "full_auto") {
    return <Badge variant="default">Oto</Badge>;
  }
  if (source === "one_click") {
    return <Badge variant="warning">Tek tık</Badge>;
  }
  return <Badge variant="secondary">Manuel</Badge>;
}

function statusLabel(status: string) {
  switch (status) {
    case "pending":
      return "Bekleyen";
    case "submitted":
      return "Gönderildi";
    case "failed":
      return "Hata";
    case "canceled":
      return "İptal";
    default:
      return status;
  }
}

function statusTone(status: string) {
  if (status === "failed") return "text-destructive";
  if (status === "submitted") return "text-success";
  if (status === "pending") return "text-warning";
  return "text-muted-foreground";
}

function sideLabel(side: string) {
  return side === "buy" ? "Alış" : side === "sell" ? "Satış" : side;
}

function shortenId(id: string | null) {
  if (!id) return "—";
  if (id.length <= 12) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

function formatDate(iso: string) {
  try {
    return new Intl.DateTimeFormat("tr-TR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export default function OrdersPage() {
  const { data: session } = useSession();
  const [orders, setOrders] = useState<BrokerOrderLedgerEntry[]>([]);
  const [brokerConnected, setBrokerConnected] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [reconciling, setReconciling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [needsBroker, setNeedsBroker] = useState(false);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!session?.accessToken) return;
      if (!opts?.silent) setLoading(true);
      setError(null);
      try {
        try {
          const profile = await apiClient.me(session.accessToken);
          setBrokerConnected(Boolean(profile.broker));
        } catch {
          // profile is optional for the ledger view
        }

        const rows = await apiClient.brokerOrders(session.accessToken);
        setOrders(rows);
        setNeedsBroker(false);
      } catch (err) {
        if (
          err instanceof ApiError &&
          (err.status === 400 || err.status === 403 || err.status === 404)
        ) {
          setNeedsBroker(true);
          setOrders([]);
          setError(null);
        } else {
          const raw = err instanceof Error ? err.message : "Emirler yüklenemedi";
          setError(raw === "Failed to fetch" ? "API’ye bağlanılamadı — sunucu ayakta mı?" : raw);
        }
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [session?.accessToken],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!session?.accessToken) return;
    const tick = () => {
      if (document.visibilityState === "visible") void load({ silent: true });
    };
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, [load, session?.accessToken]);

  const stats = useMemo(() => {
    const total = orders.length;
    const pending = orders.filter((o) => o.status === "pending").length;
    const filled = orders.filter((o) => o.status === "submitted").length;
    const failed = orders.filter((o) => o.status === "failed").length;
    return { total, pending, filled, failed };
  }, [orders]);

  async function reconcile() {
    if (!session?.accessToken) return;
    setReconciling(true);
    setNotice(null);
    setError(null);
    try {
      const result = await apiClient.reconcileBrokerOrders(session.accessToken);
      setNotice(
        `Mutabakat: ${result.checked} kontrol · ${result.updated} güncellendi` +
          (result.errors.length ? ` · ${result.errors.length} hata` : ""),
      );
      await load({ silent: true });
    } catch (err) {
      if (err instanceof ApiError && (err.status === 400 || err.status === 403)) {
        setNeedsBroker(true);
        setError(null);
      } else {
        setError(err instanceof Error ? err.message : "Mutabakat başarısız");
      }
    } finally {
      setReconciling(false);
    }
  }

  if (loading && orders.length === 0 && !needsBroker) {
    return (
      <div className="space-y-4">
        <MicroLabel>( 1 ) Emir defteri</MicroLabel>
        <LoadingBlock rows={6} />
      </div>
    );
  }

  if (needsBroker && orders.length === 0) {
    return (
      <div className="space-y-5">
        <FadeIn>
          <div>
            <MicroLabel>( 1 ) Emir defteri</MicroLabel>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">Emirler</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Broker emir defteri ve otomatik işlem izleme.
            </p>
          </div>
        </FadeIn>
        <EmptyState
          title="Broker bağlantısı yok"
          description="Gerçek veya paper broker emirlerini görmek için önce bir aracı kurum bağlayın. Simülasyon emirleri Simülasyon sayfasında izlenir."
          actionLabel="Broker ayarlarına git"
          onAction={() => {
            window.location.href = "/settings/broker";
          }}
        />
        <p className="text-center text-xs text-muted-foreground">
          veya{" "}
          <Link href="/settings/broker" className="text-primary underline-offset-2 hover:underline">
            /settings/broker
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <FadeIn>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <MicroLabel>( 1 ) Emir defteri</MicroLabel>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">Emirler</h1>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              Broker emir defteri — oto, tek tık ve manuel gönderimler. Kill-switch üst bardan.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {brokerConnected === false ? (
              <Badge variant="warning">Broker bağlı değil</Badge>
            ) : (
              <Badge variant="outline" className="uppercase tracking-[0.15em]">
                Ledger
              </Badge>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={reconciling || brokerConnected === false}
              onClick={() => void reconcile()}
            >
              <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", reconciling && "animate-spin")} />
              {reconciling ? "Mutabakat…" : "Mutabakat"}
            </Button>
          </div>
        </div>
      </FadeIn>

      {error ? (
        <Card className="rounded-2xl border-destructive/50">
          <CardContent className="py-3 text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : null}
      {notice ? (
        <Card className="rounded-2xl border-border/60">
          <CardContent className="py-3 text-sm text-muted-foreground">{notice}</CardContent>
        </Card>
      ) : null}

      <FadeIn delay={80}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Toplam emir" value={stats.total} />
          <StatCard label="Dolan / gönderilen" value={stats.filled} tone="success" />
          <StatCard label="Bekleyen" value={stats.pending} tone="warning" />
          <StatCard label="Hata" value={stats.failed} tone="destructive" />
        </div>
      </FadeIn>

      <FadeIn delay={140}>
        <SpotlightCard className="rounded-2xl">
          <CardHeader>
            <MicroLabel>( 2 ) Broker</MicroLabel>
            <CardTitle className="text-base">Broker emir defteri</CardTitle>
            <CardDescription>
              Son 100 kayıt · kaynak: oto / tek tık / manuel
            </CardDescription>
          </CardHeader>
          <CardContent>
            {orders.length === 0 ? (
              <EmptyState
                title="Henüz broker emri yok"
                description="Full auto veya tek tık ile emir gönderildiğinde burada listelenir. Simülasyon işlemleri için Simülasyon sayfasına bakın."
                actionLabel="Simülasyona git"
                onAction={() => {
                  window.location.href = "/simulation";
                }}
              />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sembol</TableHead>
                      <TableHead>Yön</TableHead>
                      <TableHead>Adet</TableHead>
                      <TableHead>Tip</TableHead>
                      <TableHead>Durum</TableHead>
                      <TableHead>Kaynak</TableHead>
                      <TableHead>Broker ID</TableHead>
                      <TableHead>Tarih</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map((order) => (
                      <TableRow key={order.id}>
                        <TableCell className="font-mono">{order.symbol}</TableCell>
                        <TableCell>{sideLabel(order.side)}</TableCell>
                        <TableCell className="font-mono">{order.quantity}</TableCell>
                        <TableCell className="font-mono text-xs uppercase">
                          {order.orderType}
                        </TableCell>
                        <TableCell className={cn("font-mono text-xs", statusTone(order.status))}>
                          {statusLabel(order.status)}
                          {order.brokerStatus ? (
                            <span className="ml-1 text-muted-foreground">
                              ({order.brokerStatus})
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell>{sourceBadge(order.source)}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {shortenId(order.brokerOrderId)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {formatDate(order.createdAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </SpotlightCard>
      </FadeIn>

      <FadeIn delay={200}>
        <SpotlightCard className="rounded-2xl">
          <CardHeader>
            <MicroLabel>( 3 ) Bilgi</MicroLabel>
            <CardTitle className="text-base">Nasıl izlenir?</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              <span className="text-foreground">Full auto</span> modundaki emirler burada (kaynak:
              Oto) ve{" "}
              <Link href="/simulation" className="text-primary underline-offset-2 hover:underline">
                Simülasyon
              </Link>{" "}
              sayfasında (kaynak: AI sinyali) birlikte izlenir.
            </p>
            <p>
              Acil durdurma için üst bardaki <span className="text-foreground">kill-switch</span>{" "}
              kullanılır; mutabakat bekleyen/gönderilen kayıtları broker ile senkronlar.
            </p>
            {brokerConnected === false ? (
              <p>
                Broker bağlı değil —{" "}
                <Link
                  href="/settings/broker"
                  className="text-primary underline-offset-2 hover:underline"
                >
                  bağlantı kurun
                </Link>{" "}
                ardından Mutabakat çalışır.
              </p>
            ) : null}
          </CardContent>
        </SpotlightCard>
      </FadeIn>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "success" | "warning" | "destructive";
}) {
  return (
    <SpotlightCard className="rounded-2xl">
      <CardContent className="py-5">
        <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{label}</p>
        <p
          className={cn(
            "mt-2 font-mono text-2xl font-medium",
            tone === "success" && "text-success",
            tone === "warning" && "text-warning",
            tone === "destructive" && "text-destructive",
          )}
        >
          <CountUp end={value} decimals={0} />
        </p>
      </CardContent>
    </SpotlightCard>
  );
}
