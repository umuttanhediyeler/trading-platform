"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Landmark, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { FadeIn } from "@/components/reactbits/FadeIn";
import { SpecularButton } from "@/components/reactbits/SpecularButton";
import { SpotlightCard } from "@/components/reactbits/SpotlightCard";
import { useExecutionStore } from "@/lib/store";
import { hasEntitlement } from "@/lib/entitlements";
import { apiClient } from "@/lib/api-client";
import type { BrokerName, BrokerProvider } from "@/lib/types";

const HOW_IT_WORKS = [
  {
    no: "( 1 )",
    title: "Kurumunu bağla",
    body: "Broker hesabının API anahtarlarını gir. Anahtarlar sunucuda şifrelenir, tarayıcına asla geri gönderilmez.",
  },
  {
    no: "( 2 )",
    title: "İşlem modunu seç",
    body: "Manuel, tek tık veya tam otomatik. Modu risk kontrolleri sayfasından istediğin an değiştirebilirsin.",
  },
  {
    no: "( 3 )",
    title: "Limitler içinde otomatik işlem",
    body: "Onaylı sinyaller, risk limitlerin içinde kaldığı sürece emre dönüşür. Kill switch her an her şeyi durdurur.",
  },
];

const EXECUTION_MODES = [
  {
    name: "Manuel",
    plan: "Tüm planlar",
    body: "Sinyaller yalnızca gösterilir; emirleri kendin girersin. Broker bağlantısı gerekmez.",
  },
  {
    name: "Tek tık",
    plan: "Basic ve üzeri",
    body: "Sinyali sen onaylarsın, emir tek tıkla bağlı brokera iletilir.",
  },
  {
    name: "Tam otomatik",
    plan: "Premium + risk onayı",
    body: "Onaylı sinyaller risk limitleri içinde otomatik olarak emre dönüşür.",
  },
];

const FALLBACK_PROVIDERS: BrokerProvider[] = [
  {
    id: "alpaca",
    name: "Alpaca",
    availability: "available",
    credentialLabels: { apiKey: "API key ID", apiSecret: "API secret key" },
    capabilities: {
      marketOrders: true,
      limitOrders: true,
      bracketOrders: true,
      fractionalQuantity: true,
      positions: "full",
      paper: true,
      live: true,
    },
    description: "ABD hisse senetleri — paper ve kontrollü live emir iletimi.",
  },
  {
    id: "binance",
    name: "Binance",
    availability: "available",
    credentialLabels: { apiKey: "API key", apiSecret: "Secret key" },
    capabilities: {
      marketOrders: true,
      limitOrders: true,
      bracketOrders: false,
      fractionalQuantity: true,
      positions: "balances_only",
      paper: true,
      live: true,
    },
    description: "Kripto spot — paper modunda Spot Testnet, live sunucu kapıları arkasında.",
  },
  {
    id: "interactive_brokers",
    name: "Interactive Brokers",
    availability: "disabled",
    credentialLabels: null,
    capabilities: null,
    description: "Client Portal Gateway oturum altyapısı kurulana kadar devre dışı.",
  },
  {
    id: "bank",
    name: "Banka entegrasyonu",
    availability: "unavailable",
    credentialLabels: null,
    capabilities: null,
    description: "Belirli bir banka API sözleşmesi olmadan genel banka adaptörü sunulmuyor.",
  },
];

type BrokerLink = { broker: BrokerName; mode: "paper" | "live"; connectedAt: string } | null;

export default function BrokerPage() {
  const { data: session } = useSession();
  const token = session?.accessToken;
  const planTier = useExecutionStore((s) => s.planTier);
  const allowed = hasEntitlement(planTier, "broker_integration");
  const [broker, setBroker] = useState<BrokerName>("alpaca");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [mode, setMode] = useState<"paper" | "live">("paper");
  const [link, setLink] = useState<BrokerLink>(null);
  const [providers, setProviders] = useState<BrokerProvider[]>(FALLBACK_PROVIDERS);
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);

  useEffect(() => {
    if (!token || !allowed) return;
    let cancelled = false;
    (async () => {
      try {
        const [me, brokerProviders] = await Promise.all([
          apiClient.me(token),
          apiClient.brokerProviders(token),
        ]);
        if (!cancelled) {
          setProviders(brokerProviders);
          if (me.broker) {
            setLink(me.broker);
            setBroker(me.broker.broker);
          }
        }
      } catch {
        // Status stays "not connected" — the connect form still works.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, allowed]);

  if (!allowed) {
    return (
      <div className="space-y-6">
        <FadeIn>
          <div>
            <p className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
              ( Otomatik İşlem )
            </p>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">
              Kurumunu Bağla
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Brokerını bağla, sinyaller risk limitlerin içinde otomatik emirlere dönüşsün.
            </p>
          </div>
        </FadeIn>
        <FadeIn delay={80}>
          <div className="rounded-2xl border border-dashed border-border bg-card/60 backdrop-blur">
            <div className="space-y-4 px-6 py-10">
              <Badge variant="warning">Basic veya Premium gerekli</Badge>
              <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
                Broker bağlantısı Free planda kapalıdır. Yükselttiğinde API anahtarların
                sunucuda şifrelenerek saklanır ve yalnızca emir iletiminde kullanılır.
              </p>
              <SpecularButton href="/settings/billing" className="px-6 py-2.5">
                Planı Yükselt
              </SpecularButton>
            </div>
          </div>
        </FadeIn>
      </div>
    );
  }

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setMessageIsError(false);
    if (!token) {
      setMessageIsError(true);
      setMessage("Oturum gerekli — tekrar giriş yapın.");
      return;
    }
    try {
      const result = await apiClient.connectBroker(token, {
        broker,
        apiKey,
        apiSecret,
        mode,
      });
      setLink({
        broker: result.broker,
        mode: result.mode as "paper" | "live",
        connectedAt: result.connectedAt,
      });
      setMessage("Bağlantı kaydedildi. Anahtarlar şifrelenerek saklandı.");
      setApiKey("");
      setApiSecret("");
    } catch (err) {
      setMessageIsError(true);
      setMessage(
        (err as Error).message ||
          "Bağlantı başarısız — API erişilemiyor veya bilgiler geçersiz.",
      );
    }
  }

  const availableProviders = providers.filter(
    (provider): provider is BrokerProvider & { id: BrokerName } =>
      provider.availability === "available" &&
      (provider.id === "alpaca" || provider.id === "binance"),
  );
  const selectedProvider =
    availableProviders.find((provider) => provider.id === broker) ?? availableProviders[0];
  const connectedProviderName =
    providers.find((provider) => provider.id === link?.broker)?.name ?? link?.broker;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <FadeIn>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
              ( Otomatik İşlem )
            </p>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">
              Kurumunu Bağla
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Brokerını bağla; sinyaller, onayladığın risk limitleri içinde otomatik emirlere
              dönüşsün.
            </p>
          </div>
          <Badge variant={link ? "success" : "outline"}>
            {link ? `Bağlı — ${connectedProviderName} (${link.mode})` : "Bağlı değil"}
          </Badge>
        </div>
      </FadeIn>

      <FadeIn delay={60}>
        <div className="grid gap-3 sm:grid-cols-3">
          {HOW_IT_WORKS.map((step) => (
            <SpotlightCard key={step.no} className="rounded-2xl">
              <div className="p-5">
                <span className="font-mono text-xs text-muted-foreground">{step.no}</span>
                <h3 className="mt-4 font-display text-base font-semibold tracking-tight">
                  {step.title}
                </h3>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{step.body}</p>
              </div>
            </SpotlightCard>
          ))}
        </div>
      </FadeIn>

      <FadeIn delay={100}>
        <div className="rounded-2xl border border-border bg-card/80 backdrop-blur">
          <div className="border-b border-border/60 px-6 py-5">
            <p className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
              ( İşlem Modları )
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Bağlantı kurulduktan sonra ne kadar otomasyon istediğine sen karar verirsin.
            </p>
          </div>
          <div className="divide-y divide-border/60">
            {EXECUTION_MODES.map((m) => (
              <div
                key={m.name}
                className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-6 py-4"
              >
                <div className="flex items-baseline gap-3">
                  <span className="font-display text-sm font-semibold">{m.name}</span>
                  <span className="text-xs text-muted-foreground">{m.body}</span>
                </div>
                <span className="font-mono text-[11px] uppercase tracking-wider text-primary">
                  {m.plan}
                </span>
              </div>
            ))}
          </div>
        </div>
      </FadeIn>

      <FadeIn delay={140}>
        <div>
          <div className="flex items-end justify-between">
            <h2 className="font-display text-xl font-semibold tracking-tight">
              Desteklenen kurumlar
            </h2>
            <span className="hidden text-[11px] uppercase tracking-[0.3em] text-muted-foreground sm:inline">
              Bağla → Seç → Otomatikleştir
            </span>
          </div>

          <div className="mt-4 rounded-2xl bg-gradient-to-b from-primary/60 via-border to-border p-px">
            <div className="rounded-2xl bg-card/90 backdrop-blur">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-6 py-5">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-terminal">
                    <Landmark className="h-4 w-4 text-primary" aria-hidden />
                  </span>
                  <div>
                    <h3 className="font-display text-base font-semibold tracking-tight">
                      {selectedProvider?.name ?? "Broker"}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {selectedProvider?.description}
                    </p>
                  </div>
                </div>
                <Badge variant="success">Aktif — REST adaptörü</Badge>
              </div>

              <div className="grid gap-6 px-6 py-6 lg:grid-cols-[0.9fr_1.1fr]">
                <div className="space-y-4">
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Sağlayıcının yalnızca işlem yetkili API anahtarlarını gir.{" "}
                    <span className="text-foreground">paper</span> modu Alpaca paper ortamını
                    veya Binance Spot Testnet&apos;i kullanır; live mod gerçek fonlara erişir.
                  </p>
                  {selectedProvider?.capabilities ? (
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Yetenekler: market ve limit emirler
                      {selectedProvider.capabilities.bracketOrders
                        ? ", atomik bracket emirler"
                        : "; atomik bracket emir desteği yok"}
                      . Pozisyon görünümü:{" "}
                      {selectedProvider.capabilities.positions === "full"
                        ? "tam pozisyon/P&L"
                        : "spot varlık bakiyeleri (maliyet bazı yok)"}.
                    </p>
                  ) : null}
                  {link ? (
                    <p className="text-xs text-muted-foreground">
                      Son bağlantı:{" "}
                      <span className="font-mono text-foreground">
                        {new Date(link.connectedAt).toLocaleString("tr-TR", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </span>{" "}
                      — mod:{" "}
                      <span className="font-mono uppercase text-foreground">{link.mode}</span>
                    </p>
                  ) : null}
                  <div className="flex items-start gap-2.5 rounded-xl border border-border/70 bg-terminal/60 p-4">
                    <Lock className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Anahtarların sunucuda AES-256-GCM ile şifrelenerek saklanır, yalnızca emir
                      iletimi sırasında çözülür ve tarayıcına asla geri gönderilmez.
                    </p>
                  </div>
                </div>

                <form className="space-y-4" onSubmit={connect}>
                  <div className="space-y-2">
                    <Label htmlFor="broker">Sağlayıcı</Label>
                    <Select
                      id="broker"
                      value={broker}
                      onChange={(e) => setBroker(e.target.value as BrokerName)}
                    >
                      {availableProviders.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {provider.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="key">
                      {selectedProvider?.credentialLabels?.apiKey ?? "API anahtarı"}
                    </Label>
                    <Input
                      id="key"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      autoComplete="off"
                      className="font-mono"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="secret">
                      {selectedProvider?.credentialLabels?.apiSecret ?? "API secret"}
                    </Label>
                    <Input
                      id="secret"
                      type="password"
                      value={apiSecret}
                      onChange={(e) => setApiSecret(e.target.value)}
                      autoComplete="off"
                      className="font-mono"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="mode">Mod</Label>
                    <Select
                      id="mode"
                      value={mode}
                      onChange={(e) => setMode(e.target.value as "paper" | "live")}
                    >
                      <option value="paper">
                        Paper — {broker === "binance" ? "Spot Testnet" : "sanal para"}, önerilen
                      </option>
                      <option value="live">Live — gerçek para</option>
                    </Select>
                  </div>
                  <Button type="submit">
                    {link ? "Bağlantıyı güncelle" : "Bağlantıyı kaydet"}
                  </Button>
                  {message ? (
                    <p
                      className={`text-sm ${messageIsError ? "text-destructive" : "text-success"}`}
                    >
                      {message}
                    </p>
                  ) : null}
                </form>
              </div>
            </div>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {providers
              .filter((provider) => provider.availability !== "available")
              .map((provider) => (
              <div
                key={provider.id}
                className="rounded-2xl border border-border/60 bg-card/40 p-5 opacity-60"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-sm font-semibold tracking-tight text-muted-foreground">
                    {provider.name}
                  </h3>
                  <Badge variant="outline">
                    {provider.availability === "disabled" ? "Devre dışı" : "Kullanılamıyor"}
                  </Badge>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground/80">
                  {provider.description}
                </p>
                {provider.setupRequirements?.length ? (
                  <ul className="mt-3 list-disc space-y-1 pl-4 text-[11px] text-muted-foreground/80">
                    {provider.setupRequirements.map((requirement) => (
                      <li key={requirement}>{requirement}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
              ))}
          </div>
        </div>
      </FadeIn>
    </div>
  );
}
