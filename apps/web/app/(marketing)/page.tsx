import Link from "next/link";
import { ArrowRight, ArrowUpRight, Check, Minus } from "lucide-react";
import { Aurora } from "@/components/reactbits/Aurora";
import { CountUp } from "@/components/reactbits/CountUp";
import { FadeIn } from "@/components/reactbits/FadeIn";
import { GradientText } from "@/components/reactbits/GradientText";
import { Marquee } from "@/components/reactbits/Marquee";
import { ShinyText } from "@/components/reactbits/ShinyText";
import { SpecularButton } from "@/components/reactbits/SpecularButton";
import { SpotlightCard } from "@/components/reactbits/SpotlightCard";
import { TiltCard } from "@/components/reactbits/TiltCard";

const SERVICES = [
  {
    no: "( 1 )",
    title: "Tarama Motoru",
    body: "Hacim, fiyat ve 40+ teknik gösterge eşiğiyle yüzlerce hisseyi saniyeler içinde filtreleyin. Kaydedilebilir taramalar, gerçek zamanlı sonuçlar.",
  },
  {
    no: "( 2 )",
    title: "AI Sinyal Motoru",
    body: "Rejim farkındalıklı makine öğrenmesi modelleri; giriş, hedef ve stop seviyeleriyle sinyal üretir. Her gece şampiyon-meydan okuyucu değerlendirmesi.",
  },
  {
    no: "( 3 )",
    title: "Simülasyon & Backtest",
    body: "Stratejilerinizi sanal hesapta ve geçmiş veride test edin. Sharpe, drawdown, kazanma oranı — hepsi tek panelde.",
  },
  {
    no: "( 4 )",
    title: "Risk Korumalı Otomasyon",
    body: "Günlük zarar limiti, işlem başına risk sınırı ve her ekrandan erişilebilen kill switch ile korunan emir otomasyonu.",
  },
];

const TICKER_TAPE = [
  ["NVDA", "+3.41%"],
  ["AAPL", "+1.24%"],
  ["MSFT", "+0.86%"],
  ["AMD", "+2.08%"],
  ["TSLA", "-1.05%"],
  ["META", "+1.62%"],
  ["GOOGL", "+0.44%"],
  ["AMZN", "+0.91%"],
  ["AVGO", "+2.74%"],
  ["JPM", "-0.32%"],
] as const;

interface PlanCard {
  name: string;
  tag: string;
  price: string;
  cta: string;
  highlight: boolean;
  features: Array<{ label: string; included: boolean; note?: string }>;
}

const PLANS: PlanCard[] = [
  {
    name: "Free",
    tag: "Keşfet",
    price: "$0",
    cta: "Ücretsiz Başla",
    highlight: false,
    features: [
      { label: "15 dk gecikmeli veri", included: true },
      { label: "5 tarama filtresi", included: true },
      { label: "Simülasyon hesabı", included: true },
      { label: "AI sinyal motoru", included: false },
      { label: "Backtest", included: false },
      { label: "Broker entegrasyonu", included: false },
    ],
  },
  {
    name: "Basic",
    tag: "Aktif Trader",
    price: "$29",
    cta: "Basic'e Geç",
    highlight: false,
    features: [
      { label: "Gerçek zamanlı veri", included: true, note: "*" },
      { label: "Sınırsız tarama filtresi", included: true },
      { label: "Simülasyon hesabı", included: true },
      { label: "Tek tıkla işlem", included: true },
      { label: "Sınırlı backtest", included: true },
      { label: "AI sinyal motoru", included: false },
    ],
  },
  {
    name: "Premium",
    tag: "Tam Güç",
    price: "$79",
    cta: "Premium'a Geç",
    highlight: true,
    features: [
      { label: "Gerçek zamanlı veri", included: true, note: "*" },
      { label: "Sınırsız tarama + backtest", included: true },
      { label: "AI sinyal motoru", included: true },
      { label: "Tam otomatik işlem", included: true, note: "risk onaylı" },
      { label: "Broker entegrasyonu", included: true },
      { label: "Öncelikli destek", included: true },
    ],
  },
];

const STACK = [
  "Alpaca Feed",
  "TimescaleDB",
  "Walk-Forward ML",
  "Triple-Barrier",
  "Regime Detection",
  "WebSocket Live",
  "Risk Guard",
  "Bracket Orders",
];

export default function LandingPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-terminal text-foreground">
      <Aurora />
      <div className="relative">
        {/* ===== Header ===== */}
        <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-lg font-semibold tracking-tight">
              Apex Scan<span className="text-primary">®</span>
            </span>
            <span className="hidden text-[11px] uppercase tracking-[0.3em] text-muted-foreground sm:inline">
              Est. 2026
            </span>
          </div>
          <nav className="flex items-center gap-8 text-sm text-muted-foreground">
            <Link href="/pricing" className="transition-colors hover:text-foreground">
              Planlar
            </Link>
            <Link href="/login" className="transition-colors hover:text-foreground">
              Giriş
            </Link>
            <Link href="/register" className="transition-colors hover:text-foreground">
              Kayıt Ol
            </Link>
          </nav>
        </header>

        {/* ===== Hero ===== */}
        <section className="mx-auto max-w-6xl px-6 pb-20 pt-16 sm:pt-24">
          <FadeIn>
            <div className="flex flex-wrap items-center gap-4 text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
              <span>AI-first tarama</span>
              <span className="h-1 w-1 rounded-full bg-primary" />
              <span>Risk-gated otomasyon</span>
              <span className="h-1 w-1 rounded-full bg-primary" />
              <span>
                <ShinyText>Sinyal · Simülasyon · Backtest</ShinyText>
              </span>
            </div>
            <h1 className="mt-6 font-display text-5xl font-semibold leading-[1.02] tracking-tight sm:text-7xl lg:text-8xl">
              Piyasayı Tara.
              <br />
              <GradientText>Geleceği Simüle Et.</GradientText>
            </h1>
            <p className="mt-8 max-w-xl text-lg leading-relaxed text-muted-foreground">
              Çok faktörlü hisse taramaları kurun, yapay zekâ sinyallerini inceleyin, stratejileri
              sanal hesapta test edin — canlı otomasyonu açık risk limitleriyle koruyun.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-4">
              <SpecularButton href="/register" className="px-8 py-4 text-base">
                Ücretsiz Başla
                <ArrowRight className="h-4 w-4" />
              </SpecularButton>
              <SpecularButton href="#planlar" variant="ghost" className="px-8 py-4 text-base">
                Planları Karşılaştır
              </SpecularButton>
            </div>
          </FadeIn>

          {/* Stats */}
          <FadeIn delay={150}>
            <div className="mt-16 grid max-w-2xl grid-cols-3 gap-px overflow-hidden rounded-2xl border border-border/60 bg-border/60">
              {[
                { end: 5000, suffix: "+", label: "Taranan sembol" },
                { end: 40, suffix: "+", label: "Teknik filtre" },
                { end: 99.9, suffix: "%", decimals: 1, label: "Uptime hedefi" },
              ].map((stat) => (
                <div key={stat.label} className="bg-terminal/90 p-5 text-center backdrop-blur">
                  <p className="font-mono text-2xl font-semibold">
                    <CountUp end={stat.end} suffix={stat.suffix} decimals={stat.decimals ?? 0} />
                  </p>
                  <p className="mt-1 text-[11px] uppercase tracking-widest text-muted-foreground">
                    {stat.label}
                  </p>
                </div>
              ))}
            </div>
          </FadeIn>
        </section>

        {/* ===== Ticker marquee ===== */}
        <section className="border-y border-border/60 bg-panel/40 py-4 backdrop-blur">
          <Marquee speed={35}>
            {TICKER_TAPE.map(([sym, chg]) => (
              <span key={sym} className="flex items-center gap-2 font-mono text-sm">
                <span className="font-semibold">{sym}</span>
                <span className={chg.startsWith("-") ? "text-destructive" : "text-success"}>
                  {chg}
                </span>
              </span>
            ))}
          </Marquee>
        </section>

        {/* ===== What we do — numbered sections ===== */}
        <section className="mx-auto max-w-6xl px-6 py-24">
          <FadeIn>
            <div className="flex items-end justify-between">
              <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-5xl">
                Neler Sunuyoruz
              </h2>
              <span className="hidden text-[11px] uppercase tracking-[0.3em] text-muted-foreground sm:inline">
                Scan → Signal → Simulate
              </span>
            </div>
          </FadeIn>
          <div className="mt-12 grid gap-4 sm:grid-cols-2">
            {SERVICES.map((s, i) => (
              <FadeIn key={s.title} delay={i * 100}>
                <TiltCard>
                  <SpotlightCard className="h-full p-8">
                    <p className="font-mono text-xs text-muted-foreground">{s.no}</p>
                    <h3 className="mt-5 font-display text-2xl font-semibold tracking-tight">
                      {s.title}
                    </h3>
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
                  </SpotlightCard>
                </TiltCard>
              </FadeIn>
            ))}
          </div>
        </section>

        {/* ===== Live preview ===== */}
        <section className="mx-auto max-w-6xl px-6 pb-24">
          <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <FadeIn>
              <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
                Canlı veri.
                <br />
                <span className="text-muted-foreground">Gerçek kararlar.</span>
              </h2>
              <p className="mt-5 max-w-md text-sm leading-relaxed text-muted-foreground">
                Alpaca beslemesinden gelen fiyat ve hacim verisi; TimescaleDB üzerinde saklanır,
                WebSocket ile ekranınıza saniyeler içinde düşer. Sinyaller yalnızca kalite
                kapılarından geçen aktif modellerden üretilir.
              </p>
            </FadeIn>
            <FadeIn delay={120}>
              <SpotlightCard className="p-5">
                <div className="mb-4 flex items-center justify-between text-xs text-muted-foreground">
                  <span className="uppercase tracking-widest">Canlı tarama önizlemesi</span>
                  <span className="flex items-center gap-1.5 font-mono text-success">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
                    Alpaca feed
                  </span>
                </div>
                <div className="space-y-2 font-mono text-sm">
                  {[
                    ["NVDA", "NVIDIA Corp.", "+3.41%", "vol× 3.4"],
                    ["AMD", "Advanced Micro Devices", "+2.08%", "vol× 2.8"],
                    ["AAPL", "Apple Inc.", "+1.24%", "vol× 2.1"],
                    ["TSLA", "Tesla Inc.", "-1.05%", "vol× 1.6"],
                  ].map(([sym, name, chg, meta]) => (
                    <div
                      key={sym}
                      className="flex items-center justify-between rounded-lg border border-border/70 bg-terminal/80 px-4 py-2.5 transition-colors hover:border-primary/40"
                    >
                      <span className="flex items-baseline gap-2">
                        <span className="font-semibold">{sym}</span>
                        <span className="hidden text-[11px] text-muted-foreground sm:inline">
                          {name}
                        </span>
                      </span>
                      <span
                        className={String(chg).startsWith("-") ? "text-destructive" : "text-success"}
                      >
                        {chg}
                      </span>
                      <span className="text-muted-foreground">{meta}</span>
                    </div>
                  ))}
                </div>
              </SpotlightCard>
            </FadeIn>
          </div>
        </section>

        {/* ===== Tech stack marquee ===== */}
        <section className="border-y border-border/60 py-6">
          <Marquee speed={40} reverse>
            {STACK.map((item) => (
              <span
                key={item}
                className="text-[13px] uppercase tracking-[0.25em] text-muted-foreground"
              >
                {item}
              </span>
            ))}
          </Marquee>
        </section>

        {/* ===== Plans ===== */}
        <section id="planlar" className="mx-auto max-w-6xl scroll-mt-24 px-6 py-24">
          <FadeIn>
            <div className="flex items-end justify-between">
              <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-5xl">
                Planını Seç
              </h2>
              <span className="hidden text-[11px] uppercase tracking-[0.3em] text-muted-foreground sm:inline">
                İstediğin zaman iptal et
              </span>
            </div>
          </FadeIn>
          <div className="mt-12 grid gap-4 lg:grid-cols-3">
            {PLANS.map((plan, i) => (
              <FadeIn key={plan.name} delay={i * 100}>
                <TiltCard maxTilt={3} className="h-full">
                  <div
                    className={
                      plan.highlight
                        ? "relative h-full rounded-2xl bg-gradient-to-b from-primary/60 via-border to-border p-px"
                        : "relative h-full rounded-2xl border border-border"
                    }
                  >
                    <div className="flex h-full flex-col rounded-2xl bg-card/90 p-7 backdrop-blur">
                      {plan.highlight && (
                        <span className="absolute -top-3 right-6 rounded-full bg-primary px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-primary-foreground">
                          En Popüler
                        </span>
                      )}
                      <p className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
                        {plan.tag}
                      </p>
                      <div className="mt-4 flex items-baseline gap-2">
                        <span className="font-display text-4xl font-semibold tracking-tight">
                          {plan.price}
                        </span>
                        <span className="text-xs text-muted-foreground">/ ay</span>
                      </div>
                      <p className="mt-1 font-display text-lg font-medium">{plan.name}</p>
                      <ul className="mt-6 flex-1 space-y-3 text-sm">
                        {plan.features.map((f) => (
                          <li key={f.label} className="flex items-start gap-2.5">
                            {f.included ? (
                              <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                            ) : (
                              <Minus className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/40" />
                            )}
                            <span
                              className={
                                f.included ? "text-foreground" : "text-muted-foreground/60"
                              }
                            >
                              {f.label}
                              {f.note && (
                                <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">
                                  {f.note}
                                </span>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <div className="mt-8">
                        <SpecularButton
                          href="/register"
                          variant={plan.highlight ? "primary" : "ghost"}
                          className="w-full px-6 py-3.5"
                        >
                          {plan.cta}
                        </SpecularButton>
                      </div>
                    </div>
                  </div>
                </TiltCard>
              </FadeIn>
            ))}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            * Gerçek zamanlı veri, veri sağlayıcı aboneliğinize bağlıdır.
          </p>
        </section>

        {/* ===== Big CTA ===== */}
        <section className="border-t border-border/60">
          <div className="mx-auto max-w-6xl px-6 py-28 text-center">
            <FadeIn>
              <p className="text-[11px] uppercase tracking-[0.35em] text-muted-foreground">
                Cesur bir stratejin mi var?
              </p>
              <h2 className="mt-5 font-display text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl">
                Hadi <GradientText>test edelim</GradientText>
              </h2>
              <p className="mx-auto mt-6 max-w-md text-sm leading-relaxed text-muted-foreground">
                Gürültü yok. Vaat yok. Sadece veriyle doğrulanmış sinyaller ve ölçülebilir sonuçlar.
              </p>
              <div className="mt-10 flex justify-center">
                <SpecularButton href="/register" className="px-10 py-4 text-base">
                  Ücretsiz Başla
                  <ArrowUpRight className="h-4 w-4" />
                </SpecularButton>
              </div>
            </FadeIn>
          </div>
        </section>

        {/* ===== Footer ===== */}
        <footer className="border-t border-border/60">
          <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-xs text-muted-foreground sm:flex-row">
            <span className="font-display text-sm font-semibold text-foreground">
              Apex Scan<span className="text-primary">®</span>
            </span>
            <div className="flex items-center gap-6">
              <Link href="/pricing" className="transition-colors hover:text-foreground">
                Planlar
              </Link>
              <Link href="/login" className="transition-colors hover:text-foreground">
                Giriş
              </Link>
              <Link href="/register" className="transition-colors hover:text-foreground">
                Kayıt Ol
              </Link>
            </div>
            <span>Apex Scan © 2026</span>
          </div>
        </footer>
      </div>
    </div>
  );
}