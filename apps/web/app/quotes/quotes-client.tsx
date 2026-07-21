"use client";

import { useRouter } from "next/navigation";

import { AuthGuard } from "@repo/auth/react";
import { useTranslations } from "@repo/i18n/web";
import { DisplayLabel } from "@repo/ui";

import { QuotesList } from "./quotes-list";

/**
 * Client subtree of the protected quotes page (ADR 0083), gated like
 * /projects. Reskinned to the shipped orders o-LIST language (ADR 0119): the
 * AppShell owns height + scroll + `bg-background`, so the authed `<main>`
 * drops `min-h-screen`/`bg-field` (the per-surface min-h fix) — the AuthGuard
 * fallback keeps `min-h-screen`/`bg-field` since it renders bare, outside the
 * shell's framed content slot.
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
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6 md:p-8">
        <DisplayLabel as="h1">{t("title")}</DisplayLabel>
        <QuotesList />
      </main>
    </AuthGuard>
  );
}
