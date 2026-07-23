"use client";

import { useEffect } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("App route error:", error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
        Geçici hata
      </p>
      <h2 className="font-display text-2xl font-semibold tracking-tight">
        Sayfa yüklenemedi
      </h2>
      <p className="text-sm text-muted-foreground">
        Bağlantı yoğunluğu veya kısa süreli API gecikmesi. Tekrar deneyin —
        verileriniz güvende.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className={cn(buttonVariants({ size: "sm" }), "rounded-full")}
        >
          Yeniden dene
        </button>
        <Link
          href="/dashboard"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "rounded-full")}
        >
          Dashboard
        </Link>
      </div>
    </div>
  );
}
