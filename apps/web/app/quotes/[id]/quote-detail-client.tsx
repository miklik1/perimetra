"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { useApiClient, useQuery } from "@repo/api/react";
import { AuthGuard } from "@repo/auth/react";
import { useTranslations } from "@repo/i18n/web";
import { Icon } from "@repo/ui";

import { errorMessageKey } from "../../../lib/error-messages";
import { createQuotesQueries } from "../../../lib/quotes-queries";
import { QuoteDetailView } from "./quote-detail";

/**
 * Client subtree of the protected quote detail page, gated like `/quotes`.
 * Reskinned to the ADR 0119 method: the AppShell owns height/scroll/`bg-background`,
 * so the authed `<main>` drops `min-h-screen`/`bg-field` (the §5 per-surface min-h
 * fix) and widens to `max-w-4xl` — a document, not a form — while the `AuthGuard`
 * fallback keeps `min-h-screen`/`bg-field` since it renders bare, outside the
 * shell's framed content slot. The plain "← Nabídky" link is replaced by a
 * registry-derived breadcrumb (`Nabídky › {documentNumber}`, mirroring the
 * orders detail's `OrderProductionClient` nav): the leaf is the SAME
 * `documentNumber` the page's own titleband shows (unlike the orders case,
 * there is no order/quote identifier split here — one document, one number).
 */
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
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6 md:p-8">
        <nav aria-label={t("title")} className="flex items-center gap-2 text-sm">
          <Link href="/quotes" className="text-muted-foreground hover:text-foreground">
            {t("title")}
          </Link>
          {quote && (
            <>
              <Icon name="chevron" size={13} aria-hidden className="text-muted-foreground" />
              <span className="font-data text-foreground">{quote.documentNumber}</span>
            </>
          )}
        </nav>
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
