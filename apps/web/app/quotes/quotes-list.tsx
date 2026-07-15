"use client";

import Link from "next/link";

import { useApiClient, useInfiniteQuery } from "@repo/api/react";
import { useLocale, useTranslations } from "@repo/i18n/web";
import { Panel } from "@repo/ui";

import { errorMessageKey } from "../../lib/error-messages";
import { formatMoney } from "../../lib/format-money";
import { createQuotesQueries } from "../../lib/quotes-queries";
import { QuoteStatusBadge } from "./quote-status";

/**
 * Per-rep quotes list (ADR 0082/0083) — infinite keyset pagination, first page
 * hydrated from the RSC prefetch. Branded: each quote is a matte `bg-chrome`
 * panel; the document number reads in the Amulya data face, the total likewise.
 *
 * Every row opens the quote detail (`/quotes/:id`) — price-blind by server-side
 * stripping for workshop (ADR 0056), still openable by them for geometry/specs.
 * The workshop's production/build surface is no longer reached from here: since
 * ADR-O1/CAR-156 it lives under `/orders` (the workshop works from orders, not
 * quotes).
 */
export function QuotesList() {
  const t = useTranslations("quotes");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const quotesQueries = createQuotesQueries(useApiClient());

  const { data, error, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery(
    quotesQueries.list(),
  );
  const quotes = data?.pages.flatMap((page) => page.items) ?? [];

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
            <Link href={`/quotes/${quote.id}`} className="block">
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
