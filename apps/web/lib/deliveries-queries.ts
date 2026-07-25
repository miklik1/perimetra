import { defineQuery, mutationOptions } from "@repo/api";
import type { ApiClient } from "@repo/api";
import { stableParams, type SearchParamsInput } from "@repo/utils";
import {
  deliveriesPageSchema,
  deliverySchema,
  sendDocumentSchema,
  type DeliveriesPage,
  type Delivery,
  type DeliveryDocumentType,
  type SendDocumentInput,
} from "@repo/validators";

/**
 * Deliveries endpoint factory + key tier (ADR 0007 pattern, mirrors
 * `createInvoicesQueries`): the per-document send history and the one outward
 * act — `POST /v1/deliveries` (ADR 0129, Wave A2). App-side consumption layer;
 * transport rides the same-origin proxy (mock group `deliveries`, or the real
 * `/v1/deliveries`).
 *
 * TWO things this factory deliberately does NOT carry, both for the same reason
 * — the delivery boundary is PII-shaped and the response schema is the real
 * control (ADR 0039 strip semantics):
 *
 * - There is no recipient anywhere. `deliverySchema` omits `recipientEmail` by
 *   construction, so the address the mail actually went to never crosses this
 *   seam and can never reach a `res.body` log line. The rep reads the address
 *   off the customer record they already may read.
 * - There is no `failureReason`. An SMTP 5xx message routinely embeds the
 *   recipient address, so the reason stays a DB-only operator column;
 *   `status: "failed"` is the whole signal a rep needs.
 *
 * `sentAt` means SMTP ACCEPTED the message — handed off, never "delivered".
 * There is no bounce feedback loop, so no caller may render it as delivery.
 */
const deliveryKeys = {
  all: ["deliveries"] as const,
  lists: () => [...deliveryKeys.all, "list"] as const,
  list: (filters?: SearchParamsInput) => [...deliveryKeys.lists(), stableParams(filters)] as const,
} as const;
export { deliveryKeys };

/**
 * `documentType` + `documentId` are BOTH required — there is deliberately no
 * org-wide delivery feed (least surface). `limit` is exposed because the one
 * consumer wants exactly the latest row; the endpoint is keyset-paginated so the
 * repo keeps ONE list idiom, but this surface never pages.
 */
export interface ListDeliveriesFilters {
  documentType: DeliveryDocumentType;
  documentId: string;
  limit?: number;
}

export interface SendDocumentVariables {
  input: SendDocumentInput;
  /** One uuid per submit attempt-chain — the server's Idempotency-Key dedupe. */
  idempotencyKey: string;
}

export function createDeliveriesQueries(client: ApiClient) {
  return {
    // GET /v1/deliveries?documentType&documentId — the send history for ONE
    // document, newest first. A plain query, not an infinite one: the surface
    // renders `items[0]` as the current state and never paginates, so modelling
    // pages here would be ceremony with no call site.
    list: (filters: ListDeliveriesFilters) =>
      defineQuery<DeliveriesPage>(client, {
        queryKey: deliveryKeys.list({ ...filters }),
        path: "/v1/deliveries",
        searchParams: { ...filters },
        schema: (data) => deliveriesPageSchema.parse(data),
      }),

    // POST /v1/deliveries (201) — send the document to its buyer. Hand-rolled
    // like `invoices.issue`, because the Idempotency-Key is per-call state the
    // builder doesn't model. Sending is OUTWARD-FACING and not undoable, so the
    // key matters more here than anywhere else in the app: the caller mints ONE
    // uuid per confirm and reuses it for every retry of that same intent, so a
    // double submit replays instead of mailing a real buyer twice.
    send: () =>
      mutationOptions({
        mutationFn: ({ input, idempotencyKey }: SendDocumentVariables) =>
          client.apiFetch<Delivery>("/v1/deliveries", {
            method: "POST",
            body: sendDocumentSchema.parse(input),
            headers: { "Idempotency-Key": idempotencyKey },
            parse: (data) => deliverySchema.parse(data),
          }) as Promise<Delivery>,
      }),
  };
}
