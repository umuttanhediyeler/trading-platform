"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Aurora } from "@/components/reactbits/Aurora";
import { FadeIn } from "@/components/reactbits/FadeIn";
import { GradientText } from "@/components/reactbits/GradientText";
import { apiClient, ApiError } from "@/lib/api-client";

const PERKS = ["Simülasyon hesabı dahil", "5 tarama filtresi", "Kredi kartı gerekmez"];

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await apiClient.register(email, password);
    } catch (err) {
      if (!(err instanceof ApiError) && !(err instanceof TypeError)) {
        setError("Kayıt başarısız oldu.");
        setLoading(false);
        return;
      }
      // Continue to local sign-in when API is unavailable in development.
    }

    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    setLoading(false);
    if (res?.error) {
      setError("Kayıt sonrası oturum başlatılamadı.");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-terminal px-4">
      <Aurora />
      <div className="relative w-full max-w-md">
        <FadeIn>
          <div className="mb-8 text-center">
            <Link href="/" className="font-display text-lg font-semibold tracking-tight">
              Apex Scan<span className="text-primary">®</span>
            </Link>
            <p className="mt-2 text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
              Scan · Signal · Simulate
            </p>
          </div>
          <div className="rounded-2xl border border-border/80 bg-card/70 p-8 backdrop-blur-xl">
            <h1 className="font-display text-2xl font-semibold tracking-tight">
              <GradientText>Hesabını oluştur</GradientText>
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Free plan ile başla, dilediğinde yükselt.
            </p>
            <ul className="mt-5 space-y-2">
              {PERKS.map((perk) => (
                <li key={perk} className="flex items-center gap-2.5 text-sm text-muted-foreground">
                  <Check className="h-4 w-4 text-primary" />
                  {perk}
                </li>
              ))}
            </ul>
            <form className="mt-6 space-y-4" onSubmit={onSubmit}>
              <div className="space-y-2">
                <Label htmlFor="email" className="text-xs uppercase tracking-widest text-muted-foreground">
                  E-posta
                </Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="ornek@mail.com"
                  className="h-11 rounded-xl bg-terminal/60"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-xs uppercase tracking-widest text-muted-foreground">
                  Şifre
                </Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="En az 8 karakter"
                  minLength={8}
                  className="h-11 rounded-xl bg-terminal/60"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <Button
                type="submit"
                className="group h-11 w-full rounded-full text-sm font-medium"
                disabled={loading}
              >
                {loading ? "Hesap oluşturuluyor…" : "Ücretsiz Başla"}
                {!loading && (
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                )}
              </Button>
            </form>
            <p className="mt-6 text-center text-sm text-muted-foreground">
              Zaten üye misin?{" "}
              <Link href="/login" className="text-foreground underline-offset-4 hover:underline">
                Giriş yap
              </Link>
            </p>
          </div>
        </FadeIn>
      </div>
    </div>
  );
}
