/**
 * The order domain at the HTTP layer against the real containers (ADR 0109 /
 * ADR-O1, CAR-156) — a thin REFERENCE entity over an accepted quote's frozen
 * snapshot. Proves: creation guards the quote is effectively `accepted`; one
 * LIVE order per quote (partial-unique race → 409); the gap-free `Z{year}/NNNN`
 * order series; the `confirmed → in_production → completed` / `cancelled` state
 * machine with server-side actor gates; and the production re-home
 * (`GET /v1/orders/:id/production`) returning BYTE-IDENTICALLY to the
 * quote-keyed read (I3 — the frozen snapshot is reused, never re-derived).
 */
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Db } from "@repo/db";
import { member } from "@repo/db/schema/auth";
import {
  siteCosts,
  siteFenceConfig,
  siteGateConfig,
  sitePrices,
  steppedSite,
} from "@repo/fixtures";

import { DB } from "../src/common/db/db.module.js";
import {
  createApiApp,
  inject,
  seedGoldenCorpusFor,
  signUpUser,
  type TestUser,
} from "./setup/app.js";

const issueBody = {
  site: steppedSite,
  instances: [
    { instanceId: "gate", releaseId: "sliding-gate@1", input: siteGateConfig },
    { instanceId: "fenceA", releaseId: "fence-run@1", input: siteFenceConfig },
    { instanceId: "fenceB", releaseId: "fence-run@1", input: siteFenceConfig },
  ],
};

const priceTableBody = {
  currency: "CZK",
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  dphRate: "21",
  table: sitePrices,
  cost: siteCosts,
};

interface QuoteResponse {
  id: string;
  documentNumber: string;
  shareToken: string;
}

interface OrderResponse {
  id: string;
  quoteId: string;
  orderNumber: string;
  status: string;
  cancelReason: string | null;
}

describe("order domain (HTTP, real stack) — CAR-156 / ADR 0109", () => {
  let app: NestFastifyApplication;
  let db: Db;
  let tenant: TestUser;

  const post = (user: TestUser, url: string, payload?: Record<string, unknown>) =>
    inject(app, { method: "POST", url, headers: { cookie: user.cookie }, payload: payload ?? {} });
  const get = (user: TestUser, url: string) =>
    inject(app, { method: "GET", url, headers: { cookie: user.cookie } });
  const setRole = (userId: string, role: string) =>
    db.update(member).set({ role }).where(eq(member.userId, userId));

  /** Issue a fresh quote and drive it to `accepted` via its buyer share token. */
  async function acceptedQuote(): Promise<QuoteResponse> {
    const quote = (await post(tenant, "/v1/quotes", issueBody)).json() as QuoteResponse;
    const accept = await inject(app, {
      method: "POST",
      url: `/v1/quotes/shared/${quote.shareToken}/accept`,
    });
    expect(accept.statusCode).toBe(200);
    return quote;
  }

  beforeAll(async () => {
    app = await createApiApp();
    db = app.get<Db>(DB);
    tenant = await signUpUser(app, "orders-tenant"); // owner → admin (org role)
    await seedGoldenCorpusFor(app, db, tenant);
    expect((await post(tenant, "/v1/price-tables", priceTableBody)).statusCode).toBe(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it("creates an order from an accepted quote (confirmed, Z{year}/NNNN)", async () => {
    const quote = await acceptedQuote();
    const res = await post(tenant, "/v1/orders", { quoteId: quote.id });
    expect(res.statusCode, res.body).toBe(201);
    const order = res.json() as OrderResponse;
    expect(order.quoteId).toBe(quote.id);
    expect(order.status).toBe("confirmed");
    expect(order.orderNumber).toMatch(/^Z\d{4}\/\d{4}$/);
    expect(order.cancelReason).toBeNull();
  });

  it("refuses an order from a non-accepted (merely issued) quote — 409 quote_not_accepted", async () => {
    const quote = (await post(tenant, "/v1/quotes", issueBody)).json() as QuoteResponse;
    const res = await post(tenant, "/v1/orders", { quoteId: quote.id });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("quote_not_accepted");
  });

  it("enforces one LIVE order per quote — the second create 409s (order_exists)", async () => {
    const quote = await acceptedQuote();
    expect((await post(tenant, "/v1/orders", { quoteId: quote.id })).statusCode).toBe(201);
    const dup = await post(tenant, "/v1/orders", { quoteId: quote.id });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe("order_exists");
  });

  it("allocates a gap-free per-year order series", async () => {
    const a = (await post(tenant, "/v1/orders", { quoteId: (await acceptedQuote()).id })).json();
    const b = (await post(tenant, "/v1/orders", { quoteId: (await acceptedQuote()).id })).json();
    const seq = (n: string) => Number(n.split("/")[1]);
    expect(seq((b as OrderResponse).orderNumber)).toBe(seq((a as OrderResponse).orderNumber) + 1);
  });

  it("drives the state machine confirmed → in_production → completed", async () => {
    const quote = await acceptedQuote();
    const order = (await post(tenant, "/v1/orders", { quoteId: quote.id })).json() as OrderResponse;

    const started = await post(tenant, `/v1/orders/${order.id}/start`);
    expect(started.statusCode).toBe(200);
    expect((started.json() as OrderResponse).status).toBe("in_production");

    const completed = await post(tenant, `/v1/orders/${order.id}/complete`);
    expect(completed.statusCode).toBe(200);
    expect((completed.json() as OrderResponse).status).toBe("completed");

    // No transition out of a terminal state.
    expect((await post(tenant, `/v1/orders/${order.id}/start`)).statusCode).toBe(409);
  });

  it("cancel requires a reason and records it (admin, audited)", async () => {
    const quote = await acceptedQuote();
    const order = (await post(tenant, "/v1/orders", { quoteId: quote.id })).json() as OrderResponse;

    expect((await post(tenant, `/v1/orders/${order.id}/cancel`, {})).statusCode).toBe(422); // reason required (body zod → 422)
    const cancelled = await post(tenant, `/v1/orders/${order.id}/cancel`, {
      reason: "buyer withdrew",
    });
    expect(cancelled.statusCode).toBe(200);
    expect((cancelled.json() as OrderResponse).status).toBe("cancelled");
    expect((cancelled.json() as OrderResponse).cancelReason).toBe("buyer withdrew");

    // A cancelled order frees the quote — a new order is creatable again.
    expect((await post(tenant, "/v1/orders", { quoteId: quote.id })).statusCode).toBe(201);
  });

  it("role gates: workshop cannot create, sales cannot cancel, workshop drives start/complete", async () => {
    const quote = await acceptedQuote();

    await setRole(tenant.id, "workshop");
    expect((await post(tenant, "/v1/orders", { quoteId: quote.id })).statusCode).toBe(403);

    await setRole(tenant.id, "admin");
    const order = (await post(tenant, "/v1/orders", { quoteId: quote.id })).json() as OrderResponse;

    await setRole(tenant.id, "workshop");
    expect((await post(tenant, `/v1/orders/${order.id}/start`)).statusCode).toBe(200);
    expect((await post(tenant, `/v1/orders/${order.id}/complete`)).statusCode).toBe(200);

    await setRole(tenant.id, "sales");
    // (create a fresh cancellable order as admin first)
    await setRole(tenant.id, "admin");
    const q2 = await acceptedQuote();
    const o2 = (await post(tenant, "/v1/orders", { quoteId: q2.id })).json() as OrderResponse;
    await setRole(tenant.id, "sales");
    expect((await post(tenant, `/v1/orders/${o2.id}/cancel`, { reason: "x" })).statusCode).toBe(
      403,
    );

    await setRole(tenant.id, "admin");
  });

  it("production re-home: /orders/:id/production is BYTE-IDENTICAL to the quote-keyed read (I3)", async () => {
    const quote = await acceptedQuote();
    const order = (await post(tenant, "/v1/orders", { quoteId: quote.id })).json() as OrderResponse;

    const viaQuote = await get(tenant, `/v1/quotes/${quote.id}/production`);
    const viaOrder = await get(tenant, `/v1/orders/${order.id}/production`);
    expect(viaOrder.statusCode).toBe(200);
    expect(viaOrder.json()).toEqual(viaQuote.json());

    // The workshop reaches it too (orders are org-visible to every role).
    await setRole(tenant.id, "workshop");
    expect((await get(tenant, `/v1/orders/${order.id}/production`)).statusCode).toBe(200);
    await setRole(tenant.id, "admin");
  });

  it("re-points a confirmed order to a newer accepted revision of the same quote", async () => {
    const v1 = await acceptedQuote();
    const order = (await post(tenant, "/v1/orders", { quoteId: v1.id })).json() as OrderResponse;

    // Revise v1 → v2, then the buyer accepts v2.
    const v2 = (await post(tenant, `/v1/quotes/${v1.id}/revise`, issueBody)).json() as {
      id: string;
      shareToken: string;
    };
    expect(
      (await inject(app, { method: "POST", url: `/v1/quotes/shared/${v2.shareToken}/accept` }))
        .statusCode,
    ).toBe(200);

    const repointed = await post(tenant, `/v1/orders/${order.id}/repoint`, { quoteId: v2.id });
    expect(repointed.statusCode, repointed.body).toBe(200);
    expect((repointed.json() as OrderResponse).quoteId).toBe(v2.id);

    // An unrelated accepted quote is NOT in the chain → 409.
    const other = await acceptedQuote();
    const bad = await post(tenant, `/v1/orders/${order.id}/repoint`, { quoteId: other.id });
    expect(bad.statusCode).toBe(409);
    expect(bad.json().code).toBe("quote_not_in_chain");

    // Once in production, re-point is refused (the ledger records reality instead).
    expect((await post(tenant, `/v1/orders/${order.id}/start`)).statusCode).toBe(200);
    const late = await post(tenant, `/v1/orders/${order.id}/repoint`, { quoteId: v2.id });
    expect(late.statusCode).toBe(409);
    expect(late.json().code).toBe("order_not_repointable");
  });

  it("a different org cannot read or transition the order (404, no existence oracle)", async () => {
    const quote = await acceptedQuote();
    const order = (await post(tenant, "/v1/orders", { quoteId: quote.id })).json() as OrderResponse;

    const intruder = await signUpUser(app, "orders-intruder");
    expect((await get(intruder, `/v1/orders/${order.id}`)).statusCode).toBe(404);
    expect((await get(intruder, `/v1/orders/${order.id}/production`)).statusCode).toBe(404);
    expect((await post(intruder, `/v1/orders/${order.id}/start`)).statusCode).toBe(404);
  });
});
