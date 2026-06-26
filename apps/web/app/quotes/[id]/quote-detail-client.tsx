"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { useApiClient, useQuery } from "@repo/api/react";
import { AuthGuard } from "@repo/auth/react";
import { useTranslations } from "@repo/i18n/web";

import { errorMessageKey } from "../../../lib/error-messages";
import { createQuotesQueries } from "../../../lib/quotes-queries";
import { QuoteDetailView } from "./quote-detail";

export function QuoteDetailClient({ id }: { id: string }) {
  const router = useRouter();
  const t = useTranslations("quotes");
  const tErrors = useTranslations("errors");
  const quotesQueries = createQuotesQueries(useApiClient());
  const { data: quote, error } = useQuery(quotesQueries.detail(id));

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
        <Link href="/quotes" className="text-muted-foreground text-sm hover:underline">
          ← {t("title")}
        </Link>
        {error && (
          <p className="text-destructive text-sm" role="alert">
            {tErrors(errorMessageKey(error))}
          </p>
        )}
        {quote && <QuoteDetailView quote={quote} />}
      </main>
    </AuthGuard>
  );
}
