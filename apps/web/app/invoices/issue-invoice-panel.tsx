"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";

import { ApiError, isConflict, isValidation } from "@repo/api";
import { useApiClient, useInfiniteQuery, useMutation, useQueryClient } from "@repo/api/react";
import { useTranslations } from "@repo/i18n/web";
import { Alert, Button, Field, Panel, Textarea } from "@repo/ui";
import { fieldInputClass } from "@repo/ui/forms/field-shell";

import { errorMessageKey } from "../../lib/error-messages";
import { createInvoicesQueries, invoiceKeys } from "../../lib/invoices-queries";
import { createOrdersQueries } from "../../lib/orders-queries";
import { toast } from "../../lib/toast";

/**
 * The typed refusals `POST /v1/invoices` answers an ISSUE with, mapped to their
 * copy under `invoices.issue.rejected.*`. Every one of them names a precondition
 * a human can actually go and fix, so each gets a title + a remedy instead of the
 * generic "validation" toast that told the rep only that something was wrong.
 *
 * This is the SAME mechanism the shipped `site/issue-quote-panel.tsx` uses (ADR
 * 0126 §7) — narrow the caught value with the `@repo/api` taxonomy (ADR 0014),
 * read the typed body `code`, resolve an i18n KEY, never a string. It is NOT a
 * second error-mapping scheme, and it deliberately does not re-derive any tax or
 * §29 semantics: the api decides what is missing, this only says it in Czech.
 *
 * Contract honesty INVERTS on a tax document (ADR 0126's governing rule): on a
 * VIEW you may honestly subtract, but on an ISSUE the server must REFUSE before a
 * gap-free document number is burned. So none of these is a warning the rep can
 * click through — each one is a wall, and this panel's whole job is to name it.
 */
const ISSUE_REJECTION_KEY = {
  legal_profile_required: "legalProfileRequired",
  legal_profile_incomplete: "legalProfileIncomplete",
  iban_required: "ibanRequired",
  customer_required: "customerRequired",
  customer_anonymized: "customerAnonymized",
  supplier_not_vat_payer: "supplierNotVatPayer",
  section29_incomplete: "section29Incomplete",
  invoice_exists: "invoiceExists",
  order_cancelled: "orderCancelled",
} as const;

type IssueRejectionCode = keyof typeof ISSUE_REJECTION_KEY;

/**
 * Exported for its unit test, not for reuse. `isValidation` (422) covers the
 * seven precondition refusals; `isConflict` (409) covers `invoice_exists` (the
 * `invoice_order_active_uq` structural guarantee: one live invoice per order) and
 * `order_cancelled`. `@repo/api-mocks` can only refuse `POST /v1/invoices` with
 * its own generic `INVALID_INPUT`, so there is no way to drive these nine codes
 * through a rendered panel — testing the recogniser directly is what keeps the
 * map honest when a backend code is renamed.
 */
export function issueRejectionCode(error: unknown): IssueRejectionCode | undefined {
  if (!(error instanceof ApiError)) return undefined;
  if (!isValidation(error) && !isConflict(error)) return undefined;
  const code = (error.body as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" && code in ISSUE_REJECTION_KEY
    ? (code as IssueRejectionCode)
    : undefined;
}

/**
 * Issue-an-invoice affordance on the invoices list (ADR 0112 / ADR 0127 Wave
 * A1): pick the order, optionally freeze a note onto the document, issue. The
 * server derives everything else — dates default in Prague (issue = today, DUZP =
 * issue, due = issue + 14d) and the quote's stamped VAT rate + frozen §92e mode
 * carry through unchanged. On success it navigates to the frozen invoice.
 *
 * The §21 rate/mode overrides and the explicit issue/DUZP/due dates are
 * deliberately NOT surfaced: they are accountant-gated legal semantics and the
 * CAR-27 pass has not run. The server defaults are correct by construction;
 * offering a rep a field that changes what a §29 document legally asserts, with
 * no review behind it, would be the opposite of honest.
 *
 * The picker offers EVERY order the org has, not just the newest keyset page: it
 * follows `GET /v1/orders` to exhaustion (see below), because the order most
 * likely to need invoicing is by construction the OLDEST open one. And it states
 * loading, failure and "genuinely none" as three different answers — never one
 * factual claim covering all three.
 *
 * The picker filters out `cancelled` orders — mirroring the api's own
 * `order_cancelled` guard from a field it already holds, so the list never
 * advertises a dead end. No other pre-filter is attempted: a client-side
 * "already invoiced" filter would be keyset-bounded and, for a sales rep whose
 * invoice list is owner-narrowed, simply wrong — a filter that is right only
 * sometimes is worse than none. The 409 `invoice_exists` refusal is the honest
 * answer, and it is rendered as a named remedy rather than a bare toast.
 */
export function IssueInvoicePanel({ onClose }: { onClose: () => void }) {
  const t = useTranslations("invoices");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const ordersQueries = createOrdersQueries(apiClient);
  const invoicesQueries = createInvoicesQueries(apiClient);

  // The order-required hint is both a visible reason and the picker's
  // `aria-describedby` target, so it needs a real, collision-free id.
  const orderHintId = useId();

  const [orderId, setOrderId] = useState("");
  const [note, setNote] = useState("");
  // How the api last refused — surfaced human-readable in the panel so the rep
  // knows exactly what to fix, never a bare toast.
  const [rejection, setRejection] = useState<IssueRejectionCode | null>(null);

  const {
    data,
    error: ordersError,
    isPending: ordersPending,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery(ordersQueries.list());
  const orders = (data?.pages.flatMap((page) => page.items) ?? []).filter(
    (order) => order.status !== "cancelled",
  );

  // `GET /v1/orders` is keyset-paginated (20 per page, newest first) and a
  // `<select>` has no load-more affordance, so the picker EXHAUSTS the cursor
  // instead of silently offering only the newest page. Without this, an order
  // confirmed in June and invoiced in August — behind twenty newer rows — has no
  // `<option>` at all and cannot be invoiced from the UI, with nothing on screen
  // saying so. The client-side `cancelled` filter shrinks the offered set further,
  // which would compound the truncation. Terminates on `hasNextPage === false`.
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // The picker renders only once the orders list has actually ANSWERED. "No order
  // available to invoice" is a factual claim about the org's data, so it may not
  // stand in for "still loading" or "the request failed" — ADR 0126's contract
  // honesty rule forbids asserting a state the backend has not backed.
  const showPicker = !ordersPending && !ordersError && orders.length > 0;

  const issue = useMutation({
    ...invoicesQueries.issue(),
    onSuccess: (created) => {
      setRejection(null);
      toast.success(t("issue.issued"));
      void queryClient.invalidateQueries({ queryKey: invoiceKeys.lists() });
      router.push(`/invoices/${created.id}`);
    },
    onError: (error) => {
      // A named precondition stays ON SCREEN with its remedy — it names a thing
      // the rep can go and fix. Only a failure we cannot name at all (network,
      // 500, an unrecognised code) falls through to the generic mapped toast.
      const code = issueRejectionCode(error);
      if (code) {
        setRejection(code);
        return;
      }
      setRejection(null);
      toast.error(tErrors(errorMessageKey(error)));
    },
  });

  const submitIssue = () => {
    // Guarded by the disabled button, but re-checked here so the invariant holds
    // for any caller: the api refuses an orderless issue and there is nothing to
    // gain from making the round trip to be told so.
    if (!orderId) return;
    setRejection(null);
    issue.mutate({
      input: { orderId, ...(note.trim() ? { note: note.trim() } : {}) },
      idempotencyKey: crypto.randomUUID(),
    });
  };

  return (
    <Panel elevation="flat">
      <div className="flex flex-col gap-3">
        <h2 className="font-display text-base">{t("issue.title")}</h2>

        {ordersPending ? (
          <p className="text-sm text-muted-foreground">{t("loading")}</p>
        ) : ordersError ? (
          <p className="text-sm text-destructive" role="alert">
            {tErrors(errorMessageKey(ordersError))}
          </p>
        ) : orders.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("issue.noOrders")}</p>
        ) : (
          <label className="flex flex-col gap-1 text-sm font-medium">
            {t("issue.order")}
            <select
              value={orderId}
              onChange={(event) => setOrderId(event.target.value)}
              className={fieldInputClass}
              required={true}
              aria-describedby={orderId ? undefined : orderHintId}
            >
              {/* A DISABLED placeholder, not a choice: the api refuses an
                  orderless issue, so offering "no order" would advertise a dead
                  end. Auto-selecting the first order was rejected outright —
                  silently invoicing whichever order happens to sort first, with
                  a gap-free document number burned for it, is a far worse
                  failure than an extra click. */}
              <option value="" disabled={true}>
                {t("issue.selectOrder")}
              </option>
              {orders.map((order) => (
                <option key={order.id} value={order.id}>
                  {order.orderNumber}
                </option>
              ))}
            </select>
          </label>
        )}

        <Field>
          <Field.Label>{t("issue.note")}</Field.Label>
          <Field.Control>
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t("issue.notePlaceholder")}
              maxLength={500}
              rows={2}
            />
          </Field.Control>
        </Field>

        {rejection && (
          <Alert tone="destructive">
            {/* `role="alert"` DERIVES from the destructive tone — never passed. */}
            <Alert.Icon />
            <Alert.Title>{t(`issue.rejected.${ISSUE_REJECTION_KEY[rejection]}Title`)}</Alert.Title>
            <Alert.Description>
              {t(`issue.rejected.${ISSUE_REJECTION_KEY[rejection]}Body`)}
            </Alert.Description>
          </Alert>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="copper"
            onClick={submitIssue}
            disabled={!orderId || issue.isPending}
          >
            {issue.isPending ? t("issue.issuing") : t("issue.submit")}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            {t("issue.cancel")}
          </Button>
        </div>
        {/* The refusal is stated BEFORE the click, not after the round trip: the
            button is disabled and the reason sits right under it, wired as the
            picker's `aria-describedby` so it is announced with the field too. It
            renders only WITH the picker — "select one above" must never point at
            a control that is not on screen. */}
        {showPicker && !orderId && (
          <p id={orderHintId} className="text-sm text-muted-foreground">
            {t("issue.orderRequired")}
          </p>
        )}
      </div>
    </Panel>
  );
}
