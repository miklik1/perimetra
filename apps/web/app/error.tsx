"use client";

import { useEffect } from "react";

import { useTranslations } from "@repo/i18n/web";
import { getTelemetry } from "@repo/telemetry";
import { Button } from "@repo/ui";

import { devErrorDetail, errorMessageKey } from "../lib/error-messages";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errors");

  useEffect(() => {
    // Route-segment render errors → telemetry (ADR 0021). No console fallback
    // needed: Next's onCaughtError logs boundary-caught errors to the console
    // itself, in production builds too (verified in the compiled bundles).
    getTelemetry().captureException(error, error.digest ? { digest: error.digest } : undefined);
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4">
      <h2 className="text-xl font-semibold">{t("title")}</h2>
      {/* User-facing copy mapped from the error kind via the catalog; the raw
          detail is shown beneath it only in development. */}
      <p className="text-muted-foreground text-sm">{t(errorMessageKey(error))}</p>
      {devErrorDetail(error) && (
        <p className="text-muted-foreground max-w-md text-xs">{devErrorDetail(error)}</p>
      )}
      <Button variant="outline" onClick={reset}>
        {t("retry")}
      </Button>
    </main>
  );
}
