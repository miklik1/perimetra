"use client";

import { useEffect } from "react";

import { getTelemetry } from "@repo/telemetry";

/**
 * Root error boundary (ADR 0021): catches errors thrown by the root layout
 * itself, where `app/error.tsx` can't help. It REPLACES the document, so it
 * must render its own <html>/<body> and can rely on no providers and no
 * stylesheet — hence inline styles and untranslated copy (the i18n provider is
 * part of what just crashed).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    getTelemetry().captureException(error, error.digest ? { digest: error.digest } : undefined);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          display: "flex",
          minHeight: "100vh",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <h2 style={{ fontSize: "1.25rem", fontWeight: 600 }}>Something went wrong</h2>
        <button
          onClick={reset}
          style={{
            padding: "0.5rem 1rem",
            border: "1px solid currentColor",
            borderRadius: "0.375rem",
            background: "transparent",
            cursor: "pointer",
            font: "inherit",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
