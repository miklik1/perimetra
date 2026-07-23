import type { Metadata } from "next";

import { getTranslations } from "@repo/i18n/web/server";
import { DisplayLabel } from "@repo/ui";

import { safeNextPath } from "../../lib/safe-redirect";
import { TwoFactorForm } from "./two-factor-form";

// Async so the browser-tab title de-Englishes with the H1: the tab must read
// the cs-primary label on a cs-default product, not a hardcoded English string.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("twoFactor.title") };
}

/**
 * The TOTP challenge step. A 2FA-enabled user is bounced here by the login form
 * (Better Auth withholds the session until the code is verified). `?next=` is
 * the same-origin destination to resume after verifying — open-redirect-guarded
 * by the same `safeNextPath` the login flow uses.
 */
export default async function TwoFactorPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  const destination = safeNextPath(typeof next === "string" ? next : null) ?? "/account";
  const t = await getTranslations("auth");
  return (
    <main className="bg-field flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      {/* The page's top-level heading — matches the sibling /login surface, which
          also renders its title as `DisplayLabel as="h1"` on the page (not inside
          the card), so heading navigation + the document outline stay semantic. */}
      <DisplayLabel as="h1">{t("twoFactor.title")}</DisplayLabel>
      <TwoFactorForm next={destination} />
    </main>
  );
}
