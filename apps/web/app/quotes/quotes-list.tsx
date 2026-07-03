"use client";

import Link from "next/link";

import { useApiClient, useInfiniteQuery } from "@repo/api/react";
import { useLocale, useTranslations } from "@repo/i18n/web";
import { Panel } from "@repo/ui";

import { errorMessageKey } from "../../lib/error-messages";
import { formatMoney } from "../../lib/format-money";
import { createQuotesQueries } from "../../lib/quotes-queries";
import { useRole } from "../../lib/use-role";
import { QuoteStatusBadge } from "./quote-status";

/**
 * Per-rep quotes list (ADR 0082/0083) — infinite keyset pagination, first page
 * hydrated from the RSC prefetch. Branded: each quote is a matte `bg-chrome`
 * panel; the document number reads in the Amulya data face, the total likewise.
 *
 * The nav entry (`lib/nav-registry.ts`, CAR-12) is ALREADY visible to any org
 * member, workshop included — this list is where CAR-24 makes that surface
 * actually useful for them: a `workshop` role routes every row to its
 * `/production` build view instead of the priced `/quotes/:id` detail (which
 * they CAN still open — the detail is price-blind by server-side stripping,
 * ADR 0056 — but production is their primary surface).
 */
export function QuotesList() {
  const t = useTranslations("quotes");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const role = useRole();
  const quotesQueries = createQuotesQueries(useApiClient());

  const { data, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery(
    quotesQueries.list(),
  );
  const quotes = data?.pages.flatMap((page) => page.items) ?? [];
  const hrefFor = (id: string) =>
    role === "workshop" ? `/quotes/${id}/production` : `/quotes/${id}`;

  return (
    <section className="flex w-full flex-col gap-3">
      {error && (
        <p className="text-destructive text-sm" role="alert">
          {tErrors(errorMessageKey(error))}
        </p>
      )}
      {quotes.length === 0 && !error && (
        <p className="text-muted-foreground rounded-md border border-dashed p-6 text-center">
          {t("empty")}
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {quotes.map((quote) => (
          <li key={quote.id}>
            <Link href={hrefFor(quote.id)} className="block">
              <Panel elevation="flat" padded={false}>
                <div className="flex items-center justify-between gap-4 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="font-data text-sm font-medium">{quote.documentNumber}</span>
                    <QuoteStatusBadge status={quote.status} />
                  </div>
                  {quote.total !== null && (
                    <span className="font-data text-sm tabular-nums">
                      {formatMoney(quote.total, locale)}
                    </span>
                  )}
                </div>
              </Panel>
            </Link>
          </li>
        ))}
      </ul>
      {quotes.length > 0 && (
        <button
          type="button"
          onClick={() => void fetchNextPage()}
          disabled={!hasNextPage || isFetchingNextPage}
          className="border-border self-start rounded-md border px-3 py-1 text-sm disabled:opacity-50"
        >
          {isFetchingNextPage ? t("loading") : hasNextPage ? t("loadMore") : t("noMore")}
        </button>
      )}
    </section>
  );
}
