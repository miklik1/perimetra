"use client";

import { useRouter } from "next/navigation";

import { useApiClient, useQuery } from "@repo/api/react";
import { AuthGuard } from "@repo/auth/react";
import { useTranslations } from "@repo/i18n/web";
import { Panel } from "@repo/ui";

import { SettingsLayout } from "../../../components/settings/settings-layout";
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
      fallback={<main className="bg-field flex min-h-screen items-center justify-center">…</main>}
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
    <SettingsLayout active="legalProfile">
      <div className="flex max-w-2xl flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">{t("title")}</h2>
          <p className="text-muted-foreground text-sm">{t("description")}</p>
        </header>

        {!isAdmin ? (
          <Panel elevation="flat">
            <Panel.Body>
              <p className="text-muted-foreground text-sm">{t("onlyAdmin")}</p>
            </Panel.Body>
          </Panel>
        ) : isLoading ? (
          <Panel elevation="flat">
            <Panel.Body>
              <p className="text-muted-foreground text-sm">…</p>
            </Panel.Body>
          </Panel>
        ) : (
          <LegalProfileForm initial={data ?? null} />
        )}
      </div>
    </SettingsLayout>
  );
}
