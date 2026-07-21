"use client";

import Link from "next/link";

import { useApiClient, useInfiniteQuery } from "@repo/api/react";
import { useLocale, useTranslations } from "@repo/i18n/web";
import { Button, EmptyState, Icon, Skeleton } from "@repo/ui";
import { formatDate } from "@repo/utils";

import { errorMessageKey } from "../../lib/error-messages";
import { formatMoney } from "../../lib/format-money";
import { createQuotesQueries } from "../../lib/quotes-queries";
import { QuoteStatusBadge } from "./quote-status";

/**
 * Per-rep quotes list (ADR 0082/0083), reskinned to the shipped orders o-LIST
 * table language (ADR 0119, design/README.md §6/§11.1) for internal-list
 * consistency — no board exists for Nabídky itself (§6: the internal list is
 * "designed from scratch in the canvas's spirit, drawing on the Zakázky list
 * language for the index"). A bare, accessible `<table>` — uppercase muted
 * column heads, hairline-divided rows, per-row hover — in place of the
 * Panel-per-row list. Infinite keyset pagination (UUIDv7 ids), first page
 * hydrated from the RSC prefetch.
 *
 * Each row is ONE focusable stretched-link anchor (the document number cell)
 * to `/quotes/:id` — full-row click/tap + a single tab stop per row; every
 * quote opens the same detail (no role-split routing, unlike orders — the
 * detail itself is price-blind by server-side stripping for workshop, ADR
 * 0056, still openable by them for geometry/specs).
 *
 * The honest divergence from the orders table: `total` IS shown here
 * (`quoteSummarySchema.total` is real money, decimal-string) but only inside
 * a `total !== null` guard — `null` means the server stripped price for a
 * workshop viewer (ADR 0056); absence, never zero, never masking. `validUntil`
 * fills the fourth column (nullable) in place of orders' `createdAt`, since
 * expiry is the quote-relevant signal and `status` already reflects it
 * (READ-time `effectiveStatus`, ADR 0083 — never re-derived here).
 */
export function QuotesList() {
  const t = useTranslations("quotes");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const quotesQueries = createQuotesQueries(useApiClient());

  const { data, error, isPending, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery(quotesQueries.list());
  const quotes = data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <section className="flex w-full flex-col gap-4">
      {error && (
        <p className="text-destructive text-sm" role="alert">
          {tErrors(errorMessageKey(error))}
        </p>
      )}
      {isPending && !error && (
        <div className="flex flex-col gap-2" aria-hidden>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}
      {!isPending && quotes.length === 0 && !error && (
        <EmptyState>
          <EmptyState.Icon>
            <Icon name="draft" />
          </EmptyState.Icon>
          <EmptyState.Title>{t("empty")}</EmptyState.Title>
          <EmptyState.Description>{t("emptyDescription")}</EmptyState.Description>
        </EmptyState>
      )}
      {quotes.length > 0 && (
        <div className="overflow-x-auto">
          <table aria-label={t("tableLabel")} className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th
                  scope="col"
                  className="text-muted-foreground pb-2 text-left text-xs font-medium uppercase tracking-wide"
                >
                  {t("columns.documentNumber")}
                </th>
                <th
                  scope="col"
                  className="text-muted-foreground pb-2 text-left text-xs font-medium uppercase tracking-wide"
                >
                  {t("columns.status")}
                </th>
                <th
                  scope="col"
                  className="text-muted-foreground pb-2 text-right text-xs font-medium uppercase tracking-wide"
                >
                  {t("columns.total")}
                </th>
                <th
                  scope="col"
                  className="text-muted-foreground pb-2 text-right text-xs font-medium uppercase tracking-wide"
                >
                  {t("columns.validUntil")}
                </th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((quote) => (
                <tr key={quote.id} className="border-border hover:bg-chrome relative border-t">
                  <td className="py-3">
                    <Link
                      href={`/quotes/${quote.id}`}
                      className="font-data focus-visible:ring-ring rounded font-medium outline-none after:absolute after:inset-0 focus-visible:ring-2"
                    >
                      {quote.documentNumber}
                    </Link>
                  </td>
                  <td className="py-3">
                    <QuoteStatusBadge status={quote.status} />
                  </td>
                  <td className="py-3 text-right">
                    {quote.total !== null && (
                      <span className="font-data tabular-nums">
                        {formatMoney(quote.total, locale)}
                      </span>
                    )}
                  </td>
                  <td className="py-3 text-right">
                    <span className="font-data text-muted-foreground tabular-nums">
                      {quote.validUntil
                        ? formatDate(quote.validUntil, { dateStyle: "medium" }, locale)
                        : "—"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {quotes.length > 0 && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void fetchNextPage()}
          disabled={!hasNextPage || isFetchingNextPage}
          className="self-start"
        >
          {isFetchingNextPage ? t("loading") : hasNextPage ? t("loadMore") : t("noMore")}
        </Button>
      )}
    </section>
  );
}
