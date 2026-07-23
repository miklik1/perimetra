import type { Metadata } from "next";
import { Suspense } from "react";

import { getTranslations } from "@repo/i18n/web/server";
import { DisplayLabel } from "@repo/ui";

import { LoginForm } from "./login-form";

// Async so the browser-tab title de-Englishes with the H1: the tab must read
// the cs-primary label on a cs-default product, not a hardcoded "Sign in".
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("login") };
}

/**
 * The password sign-in surface (ADR 0009). A chromeless, pre-session route —
 * one of `AppShell`'s `PUBLIC_PREFIXES`, so it renders as a SINGLE branch with
 * no `AuthGuard` — hence the `bg-field` page background carried on `<main>`
 * itself rather than the app shell.
 */
export default async function LoginPage() {
  const t = await getTranslations("auth");
  return (
    <main className="bg-field flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <DisplayLabel as="h1">{t("login")}</DisplayLabel>
      {/* LoginForm reads `?next=` via useSearchParams → needs a Suspense boundary. */}
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
