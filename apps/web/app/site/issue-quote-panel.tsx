"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { ApiError, isValidation } from "@repo/api";
import { useApiClient, useInfiniteQuery, useMutation, useQueryClient } from "@repo/api/react";
import type { Issue } from "@repo/engine";
import { useTranslations } from "@repo/i18n/web";
import { Alert, Button, Panel } from "@repo/ui";
import { lookupIcoSchema, type IssueQuoteInput } from "@repo/validators";

import { createCustomersQueries, customerKeys } from "../../lib/customers-queries";
import { errorMessageKey, siteInvalidIssues } from "../../lib/error-messages";
import { createQuotesQueries } from "../../lib/quotes-queries";
import { useAresLookup, useViesLookup, ViesBadge } from "../../lib/registry-lookup";
import { toast } from "../../lib/toast";
import { IssueList } from "./issue-list";

const inputClass =
  "border-border bg-background focus-visible:ring-ring rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 w-full";

/**
 * The typed 422 codes `POST /v1/quotes` refuses an ISSUE with, mapped to their
 * copy under `quotes.issue.rejected.*`. Every one of them is a precondition the
 * rep can actually fix, so each gets a title + a remedy instead of the generic
 * "validation" toast that told them only that something was wrong.
 *
 * `site_invalid` is deliberately ABSENT: it is the one rejection carrying typed
 * I5 issues, and `siteInvalidIssues` + `IssueList` already render those
 * item-by-item (CAR-162). Two shapes, two renderers, one box.
 *
 * This is the SAME mechanism `lib/error-messages.ts` uses — narrow the caught
 * value with the `@repo/api` taxonomy (ADR 0014), read the typed body `code`,
 * resolve an i18n KEY, never a string. It sits here rather than beside
 * `siteInvalidIssues` only because these codes are this one endpoint's
 * vocabulary; if a second surface ever issues a quote, hoist it there rather
 * than copying it.
 */
const ISSUE_REJECTION_KEY = {
  customer_required: "customerRequired",
  legal_profile_required: "legalProfileRequired",
  supplier_not_vat_payer: "supplierNotVatPayer",
  margin_below_floor: "marginBelowFloor",
  margin_floor_without_cost: "marginFloorWithoutCost",
} as const;

type IssueRejectionCode = keyof typeof ISSUE_REJECTION_KEY;

/**
 * Exported for its unit test, not for reuse: `@repo/api-mocks`' `POST /v1/quotes`
 * can only refuse with its own generic `INVALID_INPUT`, so there is no way to
 * drive these five codes through a rendered panel. Testing the recogniser
 * directly is what keeps the map honest when a backend code is renamed.
 */
export function issueRejectionCode(error: unknown): IssueRejectionCode | undefined {
  if (!(error instanceof ApiError) || !isValidation(error)) return undefined;
  const code = (error.body as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" && code in ISSUE_REJECTION_KEY
    ? (code as IssueRejectionCode)
    : undefined;
}

/** How the api refused the last issue attempt — the two shapes are alternatives
 *  (a rejection is either the engine's typed I5 issue list or a single named
 *  precondition), so they share one state and one banner. */
type IssueRejection =
  | { kind: "issues"; issues: Issue[] }
  | { kind: "code"; code: IssueRejectionCode };

/**
 * Issue-a-quote affordance on the site canvas (ADR 0083) — configure → attach
 * customer → issue. The buyer's VAT status auto-fills the §92e decision
 * server-side (ADR 0080/0082); the panel only sends the customer + the
 * construction/assembly scope. On success it navigates to the frozen quote.
 *
 * The odběratel is MANDATORY (ADR 0126 — `issue` 422s `customer_required`
 * without one), and this panel says so BEFORE the round trip: the picker offers
 * no "no customer" option and the Issue button is disabled with the reason
 * spelled out beneath it. The server guard stays the authority (a stale tab, a
 * deleted customer); the UI just stops pretending the state is reachable.
 */
export function IssueQuotePanel({
  projectId,
  payload,
}: {
  projectId: string;
  payload: Pick<IssueQuoteInput, "site" | "instances">;
}) {
  const t = useTranslations("quotes");
  const tErrors = useTranslations("errors");
  const tLookup = useTranslations("lookup");
  const router = useRouter();
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const customersQueries = createCustomersQueries(apiClient);
  const quotesQueries = createQuotesQueries(apiClient);

  // The buyer-required hint is both a visible reason and the picker's
  // `aria-describedby` target, so it needs a real, collision-free id.
  const customerHintId = useId();

  const [customerId, setCustomerId] = useState("");
  const [construction, setConstruction] = useState(false);
  // How the api last refused (CAR-162 + ADR 0126) — surfaced human-readable in
  // the panel so the rep knows exactly what to fix, never a bare toast.
  const [rejection, setRejection] = useState<IssueRejection | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState("");
  const [ico, setIco] = useState("");
  const [dic, setDic] = useState("");
  const [vatPayer, setVatPayer] = useState(false);

  const { data } = useInfiniteQuery(customersQueries.list());
  const customers = data?.pages.flatMap((page) => page.items) ?? [];

  const createCustomer = useMutation({
    ...customersQueries.create(),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: customerKeys.lists() });
      setCustomerId(created.id);
      setShowNew(false);
      setName("");
      setIco("");
      setDic("");
      setVatPayer(false);
    },
    onError: (error) => toast.error(tErrors(errorMessageKey(error))),
  });

  // IČO → ARES prefill (name + DIČ). Fail-soft server-side, so a non-found
  // status is a toast, never an error; vatPayer stays the rep's explicit choice.
  const ares = useAresLookup(apiClient, (prefill) => {
    if (prefill.name) setName(prefill.name);
    if (prefill.dic) setDic(prefill.dic);
  });

  // DIČ → VIES validity badge — reactive, gated on a well-formed DIČ.
  const dicTrimmed = dic.trim().toUpperCase();
  const vies = useViesLookup(apiClient, dicTrimmed);

  const issue = useMutation({
    ...quotesQueries.issue(),
    onSuccess: (quote) => {
      setRejection(null);
      toast.success(t("issue.issued"));
      router.push(`/quotes/${quote.id}`);
    },
    onError: (error) => {
      // An engine rejection (422 `site_invalid`) carries typed I5 issues —
      // render them in-panel (Czech, via IssueList), never a bare toast that
      // hides what to fix. A named precondition (422 `customer_required`,
      // `legal_profile_required`, `supplier_not_vat_payer`, the two margin-floor
      // codes) gets the same treatment: it names a thing the rep can go and fix,
      // so it stays on screen with its remedy. Only an error we can't name at
      // all — network, 500, an unrecognised code — falls through to the generic
      // mapped toast.
      const issues = siteInvalidIssues(error);
      if (issues) {
        setRejection({ kind: "issues", issues });
        return;
      }
      const code = issueRejectionCode(error);
      if (code) {
        setRejection({ kind: "code", code });
        return;
      }
      setRejection(null);
      toast.error(tErrors(errorMessageKey(error)));
    },
  });

  const submitNewCustomer = () => {
    if (!name.trim()) return;
    createCustomer.mutate({
      input: {
        name: name.trim(),
        ico: ico.trim() || null,
        dic: dic.trim() || null,
        vatPayer,
      },
      idempotencyKey: crypto.randomUUID(),
    });
  };

  const submitIssue = () => {
    // Guarded by the disabled button, but re-checked here so the invariant holds
    // for any caller: the api refuses a buyerless issue (422 `customer_required`)
    // and there is nothing to gain from making the round trip to be told so.
    if (!customerId) return;
    setRejection(null);
    issue.mutate({
      input: {
        projectId,
        site: payload.site,
        instances: payload.instances,
        customerId,
        ...(construction ? { tax: { constructionAssembly: true } } : {}),
      },
      idempotencyKey: crypto.randomUUID(),
    });
  };

  return (
    <Panel elevation="flat">
      <div className="flex flex-col gap-3">
        <h2 className="font-display text-base">{t("issue.title")}</h2>

        <label className="flex flex-col gap-1 text-sm font-medium">
          {t("issue.customer")}
          <select
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className={inputClass}
            required={true}
            aria-describedby={customerId ? undefined : customerHintId}
          >
            {/* A DISABLED placeholder, not a choice. The old "Bez odběratele"
                option offered the one state the api refuses, so the picker was
                advertising a dead end; a select still needs something to show
                while nothing is picked, and a disabled row is a prompt the rep
                cannot select back into. Auto-selecting the first customer was
                rejected outright — silently addressing an irreversible,
                gap-free-numbered document to whoever happens to sort first is a
                far worse failure than an extra click. */}
            <option value="" disabled={true}>
              {t("issue.selectCustomer")}
            </option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        {showNew ? (
          <div className="border-border flex flex-col gap-2 rounded-md border p-3">
            <input
              className={inputClass}
              placeholder={t("issue.customerName")}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                className={inputClass}
                placeholder={t("issue.ico")}
                value={ico}
                onChange={(e) => setIco(e.target.value)}
              />
              <input
                className={inputClass}
                placeholder={t("issue.dic")}
                value={dic}
                onChange={(e) => setDic(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => ares.mutate(ico.trim())}
                disabled={!lookupIcoSchema.safeParse(ico.trim()).success || ares.isPending}
              >
                {ares.isPending ? tLookup("aresLoading") : tLookup("aresLoad")}
              </Button>
              <ViesBadge result={vies.data} loading={vies.isFetching} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={vatPayer}
                onChange={(e) => setVatPayer(e.target.checked)}
                className="h-4 w-4"
              />
              {t("issue.vatPayer")}
            </label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={submitNewCustomer}
              disabled={createCustomer.isPending || !name.trim()}
            >
              {createCustomer.isPending ? t("issue.creating") : t("issue.create")}
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowNew(true)}
            className="text-copper self-start text-sm hover:underline"
          >
            + {t("issue.newCustomer")}
          </button>
        )}

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={construction}
            onChange={(e) => setConstruction(e.target.checked)}
            className="h-4 w-4"
          />
          {t("issue.constructionAssembly")}
        </label>

        {/* One banner for both rejection shapes — the kit's `Alert` (destructive
            tone derives `role="alert"`, so it announces), replacing the hand-
            rolled destructive box this panel used to draw. */}
        {rejection && (
          <Alert tone="destructive">
            <Alert.Icon />
            <Alert.Title>
              {rejection.kind === "issues"
                ? t("issue.invalidTitle")
                : t(`issue.rejected.${ISSUE_REJECTION_KEY[rejection.code]}Title`)}
            </Alert.Title>
            {rejection.kind === "issues" ? (
              // `IssueList` is a list, not a paragraph — it goes in the
              // description COLUMN (col-start-2) rather than through
              // `Alert.Description`, which renders a `<p>`.
              <div className="col-start-2 row-start-2 mt-1">
                <IssueList issues={rejection.issues} />
              </div>
            ) : (
              <Alert.Description>
                {t(`issue.rejected.${ISSUE_REJECTION_KEY[rejection.code]}Body`)}
              </Alert.Description>
            )}
          </Alert>
        )}

        {/* The refusal is stated BEFORE the click, not after the round trip: the
            button is disabled and the reason sits right under it, wired as the
            picker's `aria-describedby` so it is announced with the field too. */}
        <Button
          type="button"
          variant="copper"
          onClick={submitIssue}
          disabled={issue.isPending || !customerId}
        >
          {issue.isPending ? t("issue.issuing") : t("issue.button")}
        </Button>
        {!customerId && (
          <p id={customerHintId} className="text-muted-foreground text-xs">
            {t("issue.customerRequired")}
          </p>
        )}
      </div>
    </Panel>
  );
}
