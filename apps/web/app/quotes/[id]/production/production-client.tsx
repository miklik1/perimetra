"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { useApiClient, useQuery } from "@repo/api/react";
import { AuthGuard } from "@repo/auth/react";
import { useTranslations } from "@repo/i18n/web";

import { errorMessageKey } from "../../../../lib/error-messages";
import { createQuotesQueries } from "../../../../lib/quotes-queries";
import { ProductionView } from "./production-view";

export function ProductionClient({ id }: { id: string }) {
  const router = useRouter();
  const t = useTranslations("quotes");
  const tErrors = useTranslations("errors");
  const quotesQueries = createQuotesQueries(useApiClient());
  const { data: production, error } = useQuery(quotesQueries.production(id));

  return (
    <AuthGuard
      redirect={() => router.push("/login")}
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-field">
          {t("checkingSession")}
        </main>
      }
    >
      <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 bg-field p-8">
        <Link href={`/quotes/${id}`} className="text-sm text-muted-foreground hover:underline">
          ← {t("title")}
        </Link>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {tErrors(errorMessageKey(error))}
          </p>
        )}
        {production && (
          <ProductionView
            production={production}
            travelerHref={`/quotes/${id}/production/traveler`}
          />
        )}
      </main>
    </AuthGuard>
  );
}
