"use client";

import { useState, type ReactNode } from "react";

import { ApiError, isConflict, isValidation } from "@repo/api";
import { useApiClient, useMutation, useQuery, useQueryClient } from "@repo/api/react";
import { useLocale, useTranslations } from "@repo/i18n/web";
import { Alert, Button } from "@repo/ui";
import { formatDate } from "@repo/utils";
import { type Delivery, type DeliveryDocumentType } from "@repo/validators";

import { createDeliveriesQueries, deliveryKeys } from "../../lib/deliveries-queries";
import { errorMessageKey } from "../../lib/error-messages";
import { toast } from "../../lib/toast";
import { useRole } from "../../lib/use-role";

/**
 * The typed refusals `POST /v1/deliveries` answers with (ADR 0129 §7), mapped to
 * their copy under `deliveries.rejected.*`. Every one of them names a state a
 * human can go and inspect — a superseded document, a missing buyer, an erased
 * buyer, a buyer with no address, a send already in flight — so each gets a
 * title + a remedy rather than the generic "validation" toast.
 *
 * Same mechanism as the shipped `issue-invoice-panel.tsx` (ADR 0126 §7): narrow
 * the caught value with the `@repo/api` taxonomy (ADR 0014), read the typed body
 * `code`, resolve an i18n KEY, never a string. It is not a second error-mapping
 * scheme, and it re-derives no server rule: the api decides what is wrong, this
 * only says it in Czech.
 *
 * NOTE the deliberate absence of any client-side pre-emption of these guards.
 * A superseded document still renders the button; the typed 409 explains. One
 * rule, server-owned, no drift — the `PaymentPanel`/`already_paid` posture.
 */
const SEND_REJECTION = {
  document_superseded: "documentSuperseded",
  customer_required: "customerRequired",
  customer_anonymized: "customerAnonymized",
  recipient_email_missing: "recipientEmailMissing",
  send_in_progress: "sendInProgress",
} as const;

type SendRejectionCode = keyof typeof SEND_REJECTION;

/**
 * Exported for its unit test, not for reuse. `isValidation` (422) covers the
 * three recipient/buyer preconditions; `isConflict` (409) covers
 * `document_superseded` and the `document_delivery_inflight_uq` race that
 * surfaces as `send_in_progress`. Anything else — a 404, a 500, a network drop —
 * returns `undefined` and falls through to the shared `errorMessageKey` catalog,
 * so nothing is ever swallowed.
 */
export function sendRejectionCode(error: unknown): SendRejectionCode | undefined {
  if (!(error instanceof ApiError)) return undefined;
  if (!isValidation(error) && !isConflict(error)) return undefined;
  const code = (error.body as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" && code in SEND_REJECTION
    ? (code as SendRejectionCode)
    : undefined;
}

/**
 * The role rule for the send affordance, in ONE place: a CONFIRMED `admin`/`sales`
 * and nothing else (never `workshop`, never while `/v1/me` is still in flight).
 *
 * Exported because `SendDocumentAction` rendering `null` is INVISIBLE to its
 * parent: a surface that wraps the action in chrome of its own — a hairline, a
 * heading, a bordered block — would otherwise emit that chrome around nothing
 * for a viewer who cannot send. A parent that owns chrome asks this first; a
 * parent whose own copy stays true without the button (the invoice panel) does
 * not need it.
 */
export function useCanSendDocuments(): boolean {
  const role = useRole();
  return role === "admin" || role === "sales";
}

/**
 * Send a document to its buyer by e-mail (ADR 0129, Wave A2) — the ONE affordance,
 * shared by the quote detail and the invoice detail. What it sends is decided
 * server-side by `documentType`: a quote mail LINKS the shipped ADR-0089 public
 * landing and therefore genuinely delivers the nabídka; an invoice mail is a
 * NOTIFICATION carrying the payment identification inline and no link at all.
 * Neither claim is made here — the copy the two surfaces wrap this in says it,
 * and the templates say it to the buyer.
 *
 * Three properties this component exists to hold:
 *
 * 1. It FAILS CLOSED on role. The affordance renders only for a CONFIRMED
 *    `admin`/`sales` — never while `/v1/me` is in flight, never for `workshop`
 *    (which is price-blind by absence and must not transmit commercial
 *    documents). That mirrors `@RequireRole("admin", "sales")`; it is UX
 *    hygiene, not a security boundary — the api refuses regardless.
 * 2. A send is OUTWARD-FACING and NOT undoable, so it is never one click. The
 *    first press reveals a confirm step naming who the mail goes to and saying
 *    plainly that it cannot be taken back; only the second press sends.
 * 3. A double submit cannot become two mails. One `Idempotency-Key` uuid is
 *    minted when the confirm step OPENS and reused for every attempt within it,
 *    so a retry replays server-side rather than mailing a real buyer twice — a
 *    stricter reading of "one uuid per submit attempt-chain" than the per-click
 *    `issue` idiom, chosen deliberately because this act reaches a stranger's
 *    inbox. The buttons additionally disable while in flight, and the server's
 *    partial unique index is the structural backstop under both.
 *
 * `children` is the surface's own explainer line, rendered INSIDE the role gate:
 * a sentence promising the buyer an e-mail must not appear to a viewer who has
 * no way to send one.
 */
export function SendDocumentAction({
  documentType,
  documentId,
  children,
}: {
  documentType: DeliveryDocumentType;
  documentId: string;
  children?: ReactNode;
}) {
  const t = useTranslations("deliveries");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const canSend = useCanSendDocuments();
  const queryClient = useQueryClient();
  const deliveriesQueries = createDeliveriesQueries(useApiClient());

  // Non-null == the confirm step is open, and the value IS that step's
  // idempotency key. One piece of state for one thing, so the key cannot
  // outlive the intent it belongs to.
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [rejection, setRejection] = useState<SendRejectionCode | null>(null);

  const filters = { documentType, documentId, limit: 1 } as const;

  const { data } = useQuery({
    ...deliveriesQueries.list(filters),
    // Not merely an optimisation: a workshop session would take a 403 here, and
    // asking a question the caller may not ask is not something a UI should do.
    enabled: canSend,
  });
  const latest: Delivery | undefined = data?.items[0];

  const send = useMutation({
    ...deliveriesQueries.send(),
    onSuccess: () => {
      setRejection(null);
      setConfirmKey(null);
      void queryClient.invalidateQueries({ queryKey: deliveryKeys.lists() });
      toast.success(t("queuedToast"));
    },
    onError: (error) => {
      // The act did NOT happen, so the surface returns to a single clear
      // affordance with the reason stated beside it. A named precondition stays
      // ON SCREEN with its remedy; only a failure we cannot name at all falls
      // through to the generic mapped toast.
      setConfirmKey(null);
      const code = sendRejectionCode(error);
      if (code) {
        setRejection(code);
        return;
      }
      setRejection(null);
      toast.error(tErrors(errorMessageKey(error)));
    },
  });

  if (!canSend) return null;

  // "Odesláno" means HANDED TO THE MAIL SERVER. There is no bounce feedback
  // loop anywhere in the system, so no branch here may say "doručeno".
  const statusLine = ((): string => {
    if (!latest) return t("neverSent");
    switch (latest.status) {
      case "queued":
        return t("statusQueued");
      case "sending":
        return t("statusSending");
      case "failed":
        return t("statusFailed");
      case "sent":
        return t("statusSent", {
          date: latest.sentAt ? formatDate(latest.sentAt, undefined, locale) : "",
        });
    }
  })();

  const openConfirm = () => {
    setRejection(null);
    setConfirmKey(crypto.randomUUID());
  };

  const submit = () => {
    // Guarded by the confirm step, re-checked so the invariant holds for any
    // caller: without a key this would be an un-deduplicated outward send.
    if (confirmKey === null) return;
    send.mutate({ input: { documentType, documentId }, idempotencyKey: confirmKey });
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {children !== undefined && <p className="text-sm text-muted-foreground">{children}</p>}

      <p className="text-sm text-muted-foreground">{statusLine}</p>

      {rejection !== null && (
        <Alert tone="destructive">
          {/* `role="alert"` DERIVES from the destructive tone — never passed. */}
          <Alert.Icon />
          <Alert.Title>{t(`rejected.${SEND_REJECTION[rejection]}Title`)}</Alert.Title>
          <Alert.Description>{t(`rejected.${SEND_REJECTION[rejection]}Body`)}</Alert.Description>
        </Alert>
      )}

      {confirmKey === null ? (
        <Button
          type="button"
          variant="copper-outline"
          className="self-start"
          onClick={openConfirm}
          disabled={send.isPending}
        >
          {send.isPending ? t("sending") : latest ? t("sendAgain") : t("send")}
        </Button>
      ) : (
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-sm font-medium text-foreground">{t("confirmTitle")}</p>
          <p className="text-sm text-muted-foreground">{t("confirmBody")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="copper" onClick={submit} disabled={send.isPending}>
              {send.isPending ? t("sending") : t("confirmSubmit")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfirmKey(null)}
              disabled={send.isPending}
            >
              {t("confirmCancel")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
