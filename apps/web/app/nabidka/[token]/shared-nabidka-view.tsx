"use client";

import { useState, type ReactNode } from "react";

import { ApiError } from "@repo/api";
import { useApiClient, useMutation } from "@repo/api/react";
import { useTranslations } from "@repo/i18n/web";
import { Button } from "@repo/ui";
import { quoteStatusSchema, type QuoteStatus, type SharedNabidka } from "@repo/validators";

import { createPublicQuotesQueries } from "../../../lib/public-quotes-queries";
import { NabidkaDocumentView } from "../../quotes/[id]/nabidka/nabidka-document";

/**
 * On a 409 the quote was resolved/expired since the page loaded —
 * `resolveByShareToken` throws `ConflictException {code, status: effective}`. Lift
 * that authoritative status off the error so the view flips to the real banner
 * (and hides the now-illegal buttons) instead of a dead "try again".
 */
export function resolvedStatusFrom(error: unknown): QuoteStatus | null {
  if (error instanceof ApiError && error.status === 409) {
    const parsed = quoteStatusSchema.safeParse(
      (error.body as { status?: unknown } | undefined)?.status,
    );
    if (parsed.success) return parsed.data;
  }
  return null;
}

/**
 * The buyer's view of a shared nabídka (ADR 0089). Renders the SAME
 * `NabidkaDocumentView` the rep prints (one design, no second surface), with the
 * accept/decline affordance composed into its no-print toolbar `actions` slot.
 * The document is already built + fetched server-side; this leaf owns only the
 * resolution interaction. Status starts from the server's effective status and
 * advances locally on a successful accept/decline (the mutation returns the new
 * status — no session, so there is no authed cache to invalidate). A resolved or
 * expired quote shows an at-a-glance note instead of the buttons.
 */
export function SharedNabidkaView({ initial, token }: { initial: SharedNabidka; token: string }) {
  const t = useTranslations("quotes");
  const queries = createPublicQuotesQueries(useApiClient());
  const [status, setStatus] = useState(initial.status);
  const [errored, setErrored] = useState(false);

  const onError = (error: unknown) => {
    const resolved = resolvedStatusFrom(error);
    if (resolved)
      setStatus(resolved); // race: show the true accepted/declined/expired banner
    else setErrored(true);
  };
  const accept = useMutation({
    ...queries.accept(),
    onSuccess: (r) => setStatus(r.status),
    onError,
  });
  const decline = useMutation({
    ...queries.decline(),
    onSuccess: (r) => setStatus(r.status),
    onError,
  });
  const pending = accept.isPending || decline.isPending;

  let actions: ReactNode = null;
  if (status === "issued") {
    actions = (
      <>
        {errored && (
          <span role="alert" className="text-destructive text-sm">
            {t("buyer.error")}
          </span>
        )}
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => {
            setErrored(false);
            decline.mutate(token);
          }}
        >
          {t("buyer.decline")}
        </Button>
        <Button
          type="button"
          variant="copper"
          disabled={pending}
          onClick={() => {
            setErrored(false);
            accept.mutate(token);
          }}
        >
          {t("buyer.accept")}
        </Button>
      </>
    );
  } else if (status === "accepted") {
    actions = (
      <span role="status" className="font-data text-muted-foreground text-sm">
        {t("buyer.accepted")}
      </span>
    );
  } else if (status === "declined") {
    actions = (
      <span role="status" className="font-data text-muted-foreground text-sm">
        {t("buyer.declined")}
      </span>
    );
  } else if (status === "expired") {
    actions = (
      <span role="status" className="font-data text-muted-foreground text-sm">
        {t("buyer.expired")}
      </span>
    );
  }

  return <NabidkaDocumentView doc={initial.document} actions={actions} />;
}
