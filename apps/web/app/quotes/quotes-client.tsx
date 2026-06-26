"use client";

import { useRouter } from "next/navigation";

import { AuthGuard } from "@repo/auth/react";
import { useTranslations } from "@repo/i18n/web";
import { DisplayLabel } from "@repo/ui";

import { QuotesList } from "./quotes-list";

/**
 * Client subtree of the protected quotes page (ADR 0083), gated like /projects.
 * Branded on the Part-A neutral system: a warm `bg-field` canvas, a Chillax
 * display heading, the list in matte `bg-chrome` panels.
 */
export function QuotesClient() {
  const router = useRouter();
  const t = useTranslations("quotes");
  return (
    <AuthGuard
      redirect={() => router.push("/login")}
      fallback={
        <main className="bg-field flex min-h-screen items-center justify-center">
          {t("checkingSession")}
        </main>
      }
    >
      <main className="bg-field mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 p-8">
        <DisplayLabel as="h1">{t("title")}</DisplayLabel>
        <QuotesList />
      </main>
    </AuthGuard>
  );
}
