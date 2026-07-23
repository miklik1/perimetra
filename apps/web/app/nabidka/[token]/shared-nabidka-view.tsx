"use client";

import { useState } from "react";

import { ApiError } from "@repo/api";
import { useApiClient, useMutation } from "@repo/api/react";
import { quoteStatusSchema, type QuoteStatus, type SharedNabidka } from "@repo/validators";

import { createPublicQuotesQueries } from "../../../lib/public-quotes-queries";
import { NabidkaLandingView } from "./nabidka-landing";

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
 * The OTHER 409 shape the buyer resolve path can throw (ADR-O1/CAR-158): a
 * superseded quote's `status` is untouched (supersession is a separate
 * pointer, `sharedNabidkaSchema.superseded`), so `resolveByShareToken` 409s
 * with `{code: "quote_superseded"}` and NO `status` field — `resolvedStatusFrom`
 * always returns `null` for it. Detected separately so that specific race (the
 * buyer's page loaded before a revise/supersede happened, and their click
 * lands after) flips the view to the superseded banner instead of the generic
 * "try again" error.
 */
export function isSupersededConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && error.code === "quote_superseded";
}

/**
 * The buyer's view of a shared nabídka (ADR 0089; the ADR-0089 REVERSAL for
 * Wave B — a branded landing surface, `NabidkaLandingView`, replaces the
 * PDF-twin `NabidkaDocumentView` render this route used to do). The document
 * is already built + fetched server-side (RSC); this leaf owns the
 * accept/decline interaction and the two independent status signals a buyer
 * can face: `status` (starts from the server's effective status, advances
 * locally on a successful accept/decline — the mutation returns the new
 * status, and there is no session so there is no authed cache to invalidate)
 * and `superseded` (starts from the server's flag, and can ALSO flip locally
 * mid-session on the `quote_superseded` 409 race described above).
 */
export function SharedNabidkaView({ initial, token }: { initial: SharedNabidka; token: string }) {
  const queries = createPublicQuotesQueries(useApiClient());
  const [status, setStatus] = useState(initial.status);
  const [superseded, setSuperseded] = useState(initial.superseded);
  const [errored, setErrored] = useState(false);

  const onError = (error: unknown) => {
    if (isSupersededConflict(error)) {
      setSuperseded(true);
      return;
    }
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

  return (
    <NabidkaLandingView
      doc={initial.document}
      status={status}
      validUntil={initial.validUntil}
      superseded={superseded}
      pending={pending}
      errored={errored}
      onAccept={() => {
        setErrored(false);
        accept.mutate(token);
      }}
      onDecline={() => {
        setErrored(false);
        decline.mutate(token);
      }}
    />
  );
}
