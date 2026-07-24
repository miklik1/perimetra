"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { useApiClient, useQuery } from "@repo/api/react";
import { AuthGuard } from "@repo/auth/react";
import { useTranslations } from "@repo/i18n/web";
import { Icon } from "@repo/ui";

import { errorMessageKey } from "../../../lib/error-messages";
import { createInvoicesQueries } from "../../../lib/invoices-queries";
import { InvoiceDetailView } from "./invoice-detail";

/**
 * Client subtree of the protected invoice detail page (ADR 0127), gated exactly
 * like `/quotes/:id`. The AppShell owns height/scroll/`bg-background`, so the
 * authed `<main>` drops `min-h-screen`/`bg-field` and widens to `max-w-4xl` — a
 * document, not a form — while the `AuthGuard` fallback KEEPS `min-h-screen`/
 * `bg-field` since it renders bare, outside the shell's framed content slot.
 *
 * The breadcrumb leaf is the SAME `documentNumber` the titleband shows (one
 * document, one number — the quote-detail idiom), and it only appears once the
 * row has loaded, so the nav never flashes a bare chevron.
 */
export function InvoiceDetailClient({ id }: { id: string }) {
  const router = useRouter();
  const t = useTranslations("invoices");
  const tErrors = useTranslations("errors");
  const invoicesQueries = createInvoicesQueries(useApiClient());
  const { data: invoice, error } = useQuery(invoicesQueries.detail(id));

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
          <Link href="/invoices" className="text-muted-foreground hover:text-foreground">
            {t("title")}
          </Link>
          {invoice && (
            <>
              <Icon name="chevron" size={13} aria-hidden className="text-muted-foreground" />
              <span className="font-data text-foreground">{invoice.documentNumber}</span>
            </>
          )}
        </nav>
        {error && (
          <p className="text-destructive text-sm" role="alert">
            {tErrors(errorMessageKey(error))}
          </p>
        )}
        {invoice && <InvoiceDetailView invoice={invoice} />}
      </main>
    </AuthGuard>
  );
}
