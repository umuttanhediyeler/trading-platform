"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Aurora } from "@/components/reactbits/Aurora";
import { FadeIn } from "@/components/reactbits/FadeIn";
import { GradientText } from "@/components/reactbits/GradientText";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await signIn("credentials", {
      email,
      password,
      rememberMe: rememberMe ? "true" : "false",
      redirect: false,
    });
    setLoading(false);
    if (res?.error) {
      setError("Giriş başarısız. Bilgilerinizi kontrol edin.");
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
              <GradientText>Tekrar hoş geldin</GradientText>
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Hesabına giriş yap ve kaldığın yerden devam et.
            </p>
            <form className="mt-7 space-y-4" onSubmit={onSubmit}>
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
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="h-11 rounded-xl bg-terminal/60"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              <label className="flex cursor-pointer items-center gap-2.5 select-none">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border accent-primary"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                />
                <span className="text-sm text-muted-foreground">
                  Beni hatırla <span className="text-xs opacity-70">(30 gün)</span>
                </span>
              </label>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <Button
                type="submit"
                className="group h-11 w-full rounded-full text-sm font-medium"
                disabled={loading}
              >
                {loading ? "Giriş yapılıyor…" : "Giriş Yap"}
                {!loading && (
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                )}
              </Button>
            </form>
            <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
              <div className="h-px flex-1 bg-border" />
              veya
              <div className="h-px flex-1 bg-border" />
            </div>
            <Button
              type="button"
              variant="outline"
              className="h-11 w-full rounded-full"
              onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
            >
              Google ile devam et
            </Button>
            <p className="mt-6 text-center text-sm text-muted-foreground">
              Hesabın yok mu?{" "}
              <Link href="/register" className="text-foreground underline-offset-4 hover:underline">
                Ücretsiz kayıt ol
              </Link>
            </p>
          </div>
          <p className="mt-6 text-center text-xs text-muted-foreground">
            Girişle birlikte kullanım koşullarını kabul etmiş olursun.
          </p>
        </FadeIn>
      </div>
    </div>
  );
}
