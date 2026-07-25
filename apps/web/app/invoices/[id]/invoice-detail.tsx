"use client";

import Link from "next/link";
import { useState } from "react";

import { ApiError, isConflict } from "@repo/api";
import { useApiClient, useMutation, useQueryClient } from "@repo/api/react";
import { useLocale, useTranslations } from "@repo/i18n/web";
import { Button, DisplayLabel, Field, Icon, Input, KeyValueList, Panel } from "@repo/ui";
import { formatCalendarDate, formatDate } from "@repo/utils";
import { type Invoice } from "@repo/validators";

import { SendDocumentAction } from "../../../components/send-document/send-document-action";
import { errorMessageKey } from "../../../lib/error-messages";
import { formatMoney } from "../../../lib/format-money";
import { createInvoicesQueries, invoiceKeys } from "../../../lib/invoices-queries";
import { toast } from "../../../lib/toast";
import { useRole } from "../../../lib/use-role";
import { InvoiceStatusBadge } from "../invoice-status";

/**
 * The two typed 409s the payment transitions answer with. They are TRANSIENT
 * race conditions (a colleague marked it a second earlier), not preconditions
 * the rep must go and fix — so they surface as a NAMED toast rather than the
 * in-panel banner the issue-time refusals get. Anything unrecognised falls
 * through to the shared `errorMessageKey` catalog; nothing is swallowed.
 */
const PAYMENT_REJECTION = { already_paid: "alreadyPaid", not_paid: "notPaid" } as const;
type PaymentRejectionCode = keyof typeof PAYMENT_REJECTION;

function paymentRejectionCode(error: unknown): PaymentRejectionCode | undefined {
  if (!(error instanceof ApiError) || !isConflict(error)) return undefined;
  const code = (error.body as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" && code in PAYMENT_REJECTION
    ? (code as PaymentRejectionCode)
    : undefined;
}

/**
 * "This document was superseded" — the same shape as the quote detail's
 * `LineagePanel`, deliberately NOT extracted into a shared component and
 * deliberately NOT parameterised by its copy: an invoice carries exactly ONE
 * lineage pointer (`supersededById`; a tax document has no `revisionOfId`), so
 * the quote's two-tone, four-label abstraction would be generalising from a
 * single call site. The one thing that varies is the target, so the target is
 * the one prop.
 *
 * It links BY ID with a generic label, because `invoiceSummarySchema` carries
 * only the sibling's uuid, never its `documentNumber` — the same deferred
 * second round-trip the quote surface records.
 */
function SupersededPanel({ href }: { href: string }) {
  const t = useTranslations("invoices");
  return (
    <Panel elevation="flat">
      <div className="flex items-start gap-3">
        <Icon name="warn" aria-hidden className="text-muted-foreground mt-0.5 shrink-0" />
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="font-display text-lg">{t("lineage.supersededTitle")}</h2>
          <p className="text-muted-foreground text-sm">{t("lineage.supersededBody")}</p>
          <Link href={href} className="text-copper text-sm font-medium hover:underline">
            {t("lineage.viewSuperseding")}
          </Link>
        </div>
      </div>
    </Panel>
  );
}

/**
 * Delivery (ADR 0129, Wave A2) — mailing the buyer that this invoice exists.
 *
 * The panel's body copy is the load-bearing part, and it states to the REP
 * exactly what the mail is and is not: the buyer receives a NOTIFICATION with
 * the payment identification inline (number, VS, amount, due date, IBAN) and no
 * link at all — the daňový doklad itself is still handed over by the rep. That
 * is the ADR-0126 rule read the other way round for an outward message: a mail
 * that presented itself as the tax document while carrying a summary would be
 * the same mislabel class as a "Daňový doklad" heading on a nabídka.
 *
 * It sits between the lineage notice and `PaymentPanel` because delivery is a
 * DOCUMENT act (what happened to the doklad) while payment is ROW state (what
 * happened to the money).
 *
 * The copy renders for every viewer, including one who cannot send: it is a
 * true statement about the document either way. Only the affordance is gated,
 * and that gate lives inside `SendDocumentAction` — one role rule, one place.
 *
 * PROVISIONAL (CAR-27 pass 2): the accountant pass has not run. Nothing here
 * claims legal correctness of the mail, of its characterisation, or of sending
 * a document to a buyer as a processing act.
 */
function DeliveryPanel({ invoiceId }: { invoiceId: string }) {
  const t = useTranslations("deliveries");
  return (
    <Panel elevation="flat">
      <div className="flex min-w-0 flex-col gap-3">
        <h2 className="font-display text-lg">{t("invoicePanelTitle")}</h2>
        <p className="text-muted-foreground text-sm">{t("invoiceBody")}</p>
        <SendDocumentAction documentType="invoice" documentId={invoiceId} />
      </div>
    </Panel>
  );
}

/**
 * Payment — ROW state, never document content (ADR 0112 §5). A "PAID" mark must
 * never reach the frozen §29 sheet, which is why this panel lives here and not
 * on `/invoices/:id/faktura`.
 *
 * The affordance is gated on `useRole() === "admin"`, mirroring
 * `@RequireRole("admin")` on mark-paid/unmark-paid, and FAILS CLOSED while
 * `/v1/me` is in flight. That is UX hygiene, NOT a security boundary: the api
 * is the authority and refuses a non-admin regardless of what renders here.
 */
function PaymentPanel({ invoice }: { invoice: Invoice }) {
  const t = useTranslations("invoices");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const queryClient = useQueryClient();
  const invoicesQueries = createInvoicesQueries(useApiClient());
  const canMarkPaid = useRole() === "admin";
  const [note, setNote] = useState("");

  const applyUpdate = (updated: Invoice, message: string) => {
    queryClient.setQueryData(invoiceKeys.detail(invoice.id), updated);
    void queryClient.invalidateQueries({ queryKey: invoiceKeys.lists() });
    toast.success(message);
  };
  const reportFailure = (error: unknown) => {
    const code = paymentRejectionCode(error);
    toast.error(
      code ? t(`payment.rejected.${PAYMENT_REJECTION[code]}`) : tErrors(errorMessageKey(error)),
    );
  };

  const markPaid = useMutation({
    ...invoicesQueries.markPaid(),
    onSuccess: (updated) => applyUpdate(updated, t("payment.marked")),
    onError: reportFailure,
  });
  const unmarkPaid = useMutation({
    ...invoicesQueries.unmarkPaid(),
    onSuccess: (updated) => applyUpdate(updated, t("payment.unmarked")),
    onError: reportFailure,
  });

  const submitMarkPaid = () => {
    const trimmed = note.trim();
    markPaid.mutate({ id: invoice.id, input: trimmed ? { note: trimmed } : {} });
  };

  return (
    <Panel elevation="flat">
      <div className="flex min-w-0 flex-col gap-3">
        <h2 className="font-display text-lg">{t("payment.title")}</h2>
        <p className="text-muted-foreground text-sm">{t("payment.body")}</p>

        {invoice.status === "paid" && (
          <KeyValueList className="w-full">
            <KeyValueList.Row label={t("payment.paidAt")}>
              {invoice.paidAt ? formatDate(invoice.paidAt, { dateStyle: "medium" }, locale) : "—"}
            </KeyValueList.Row>
            {invoice.paidNote !== null && (
              <KeyValueList.Row label={t("payment.paidNote")}>{invoice.paidNote}</KeyValueList.Row>
            )}
          </KeyValueList>
        )}

        {!canMarkPaid ? (
          <p className="text-muted-foreground text-sm">{t("payment.adminOnly")}</p>
        ) : invoice.status === "issued" ? (
          <div className="flex flex-col gap-3">
            <Field>
              <Field.Label>{t("payment.note")}</Field.Label>
              <Field.Control>
                <Input
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  maxLength={500}
                  placeholder={t("payment.notePlaceholder")}
                />
              </Field.Control>
            </Field>
            <Button
              type="button"
              variant="copper-outline"
              className="self-start"
              onClick={submitMarkPaid}
              disabled={markPaid.isPending}
            >
              {markPaid.isPending ? t("payment.marking") : t("payment.markPaid")}
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => unmarkPaid.mutate(invoice.id)}
            disabled={unmarkPaid.isPending}
          >
            {unmarkPaid.isPending ? t("payment.unmarking") : t("payment.unmarkPaid")}
          </Button>
        )}
      </div>
    </Panel>
  );
}

/**
 * Reproducibility — the same customer-facing TRUST affordance the quote detail
 * carries (ADR 0083), pointed at `POST /v1/invoices/:id/verify`: the api
 * re-derives the invoice from its frozen facts and deep-equals the result
 * against the stored snapshot (I3, ADR 0112 §6).
 *
 * The outcome is a THREE-WAY EXPLICIT branch — `=== true`, `=== false`, error —
 * never a truthiness collapse, because "not reproduced" and "the check itself
 * failed" are different answers and only one of them is a document problem.
 */
function TrustPanel({ invoiceId }: { invoiceId: string }) {
  const t = useTranslations("invoices");
  const tErrors = useTranslations("errors");
  const invoicesQueries = createInvoicesQueries(useApiClient());
  const verify = useMutation(invoicesQueries.verify());

  return (
    <Panel elevation="flat">
      <div className="flex min-w-0 flex-col gap-3">
        <h2 className="font-display text-lg">{t("trust.title")}</h2>
        <p className="text-muted-foreground text-sm">{t("trust.body")}</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="copper-outline"
            onClick={() => verify.mutate(invoiceId)}
            disabled={verify.isPending}
          >
            <Icon name="reproduce" aria-hidden />
            {verify.isPending ? t("trust.verifying") : t("trust.verify")}
          </Button>
          {verify.data?.reproduced === true && (
            <span className="text-success text-sm font-medium" role="status">
              ✓ {t("trust.reproduced")}
            </span>
          )}
          {verify.data?.reproduced === false && (
            <span className="text-destructive text-sm font-medium" role="status">
              ✗ {t("trust.mismatch")}
            </span>
          )}
          {verify.error && (
            <span className="text-destructive text-sm" role="alert">
              {tErrors(errorMessageKey(verify.error))}
            </span>
          )}
        </div>
      </div>
    </Panel>
  );
}

/**
 * The invoice detail VIEW (ADR 0127) — presentational shell plus the three row
 * actions (mark paid / unmark paid / verify) and the link to the print sheet.
 *
 * It renders NO document lines, NO VAT recapitulation and NO §92e legend. Those
 * are FROZEN document content in the kernel's own money format (dot-decimal
 * `formatCents` strings) and live on `/invoices/:id/faktura`, so exactly ONE
 * money formatter runs per screen: this surface shows only `invoice.total`, the
 * I10 decimal-koruna row value, through `formatMoney`. Mixing the two classes on
 * one screen would invite the second money path the 2026-07-14 no-duplication
 * ruling forbids. Subtracting them here is honest — this is a VIEW, not an
 * ISSUE, and the full document is one click away.
 *
 * PROVISIONAL (CAR-27 pass 2): the accountant pass has not run. Nothing on this
 * surface claims legal correctness of the field selection or the labelling.
 */
export function InvoiceDetailView({ invoice }: { invoice: Invoice }) {
  const t = useTranslations("invoices");
  const locale = useLocale();
  // `issuedOn` / `duzp` / `dueOn` are `isoDate` — statutory CALENDAR days, not
  // instants — so they render through `formatCalendarDate`, which pins
  // `timeZone: "UTC"` (ADR 0105). Through plain `formatDate` a viewer west of
  // UTC would see the previous day: DUZP decides the DPH period, and the screen
  // would then disagree with the frozen date the §29 sheet prints verbatim.
  // `paidAt` (an `isoDatetime` instant) correctly stays on `formatDate` above.
  const calendar = (value: string) => formatCalendarDate(value, { dateStyle: "medium" }, locale);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {/* Titleband — the document identity band (ADR 0120): eyebrow, the number
          as the H1, then the actions with the status badge LAST. */}
      <div className="border-primary flex flex-col gap-4 border-b-2 pb-4 md:flex-row md:items-end md:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-muted-foreground text-xs font-semibold uppercase tracking-wide">
            {t("detail.eyebrow")}
          </span>
          <DisplayLabel as="h1" className="font-data text-3xl sm:text-4xl">
            {invoice.documentNumber}
          </DisplayLabel>
        </div>
        <div className="flex min-w-0 flex-col items-start gap-3 md:items-end">
          <div className="flex flex-wrap items-center gap-3">
            {/* The §29 sheet. Named after the Czech document it prints (the
             *  `/quotes/:id/nabidka` precedent) and rendered CHROMELESS — the
             *  shell drops its rails on a `/faktura` suffix. */}
            <Link
              href={`/invoices/${invoice.id}/faktura`}
              className="text-copper text-sm font-medium hover:underline"
            >
              {t("print.open")}
            </Link>
            <InvoiceStatusBadge status={invoice.status} />
          </div>
          <KeyValueList className="w-full min-w-56">
            <KeyValueList.Row label={t("detail.number")} mono>
              {invoice.documentNumber}
            </KeyValueList.Row>
            <KeyValueList.Row label={t("detail.issuedOn")}>
              {calendar(invoice.issuedOn)}
            </KeyValueList.Row>
            <KeyValueList.Row label={t("detail.duzp")}>{calendar(invoice.duzp)}</KeyValueList.Row>
            <KeyValueList.Row label={t("detail.dueOn")}>{calendar(invoice.dueOn)}</KeyValueList.Row>
            <KeyValueList.Row label={t("detail.variableSymbol")} mono>
              {invoice.variableSymbol}
            </KeyValueList.Row>
            <KeyValueList.Row label={t("detail.total")}>
              {formatMoney(invoice.total, locale)}
            </KeyValueList.Row>
          </KeyValueList>
        </div>
      </div>

      {invoice.supersededById !== null && (
        <SupersededPanel href={`/invoices/${invoice.supersededById}`} />
      )}

      <DeliveryPanel invoiceId={invoice.id} />
      <PaymentPanel invoice={invoice} />
      <TrustPanel invoiceId={invoice.id} />
    </div>
  );
}
