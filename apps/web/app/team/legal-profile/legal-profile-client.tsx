"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { useApiClient, useQuery } from "@repo/api/react";
import { AuthGuard } from "@repo/auth/react";
import { useTranslations } from "@repo/i18n/web";

import { createLegalProfileQueries } from "../../../lib/legal-profile-queries";
import { useIsAdmin } from "../../../lib/use-role";
import { LegalProfileForm } from "./legal-profile-form";

/**
 * Legal-profile settings client (ADR 0088). Admin-only (mirrors the server's
 * `@RequireRole('admin')` — the authoritative gate); a non-admin sees a notice.
 * Loads the singleton off `/v1/org/legal-profile` and renders the pre-filled form.
 */
export function LegalProfileClient() {
  const router = useRouter();
  return (
    <AuthGuard
      redirect={() => router.push("/login")}
      fallback={<main className="flex min-h-screen items-center justify-center">…</main>}
    >
      <Content />
    </AuthGuard>
  );
}

function Content() {
  const t = useTranslations("legalProfile");
  const isAdmin = useIsAdmin();
  const client = useApiClient();
  const queries = createLegalProfileQueries(client);
  const { data, isLoading } = useQuery({ ...queries.get(), enabled: isAdmin });

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 p-8">
      <header className="flex flex-col gap-1">
        <Link href="/team" className="text-muted-foreground text-sm hover:underline">
          ← {t("backToTeam")}
        </Link>
        <h1 className="font-display text-2xl">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("description")}</p>
      </header>

      {!isAdmin ? (
        <p className="text-muted-foreground text-sm">{t("onlyAdmin")}</p>
      ) : isLoading ? (
        <p className="text-muted-foreground text-sm">…</p>
      ) : (
        <LegalProfileForm initial={data ?? null} />
      )}
    </main>
  );
}
