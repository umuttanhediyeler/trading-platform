"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="tr">
      <body className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
        <div className="max-w-md rounded-3xl border border-border bg-card p-8 text-center">
          <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
            ( Sistem Hatası )
          </p>
          <h1 className="mt-3 font-display text-2xl font-semibold tracking-tight">
            Beklenmeyen bir hata oluştu
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Hata izleme sistemine kaydedildi. Sayfayı yeniden deneyebilirsiniz.
          </p>
          <button
            type="button"
            onClick={reset}
            className="mt-6 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground"
          >
            Tekrar dene
          </button>
        </div>
      </body>
    </html>
  );
}
