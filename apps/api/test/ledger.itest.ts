/**
 * Deviation / exception ledger (ADR 0110 / ADR-O4, CAR-159) at the HTTP layer
 * against the real containers. Proves: a production-time order exception is
 * recorded and queryable (`GET /v1/ledger`); cancelling an in-production order
 * writes an `order_exception` row (stranded material); the ledger is admin-only
 * (workshop 403 — it carries margin values); and the snapshot-driven rebuild is
 * idempotent (the golden corpus has no quote-scope overrides → 0 projected).
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

interface LedgerEntry {
  id: string;
  quoteId: string;
  orderId: string | null;
  source: string;
  reason: string;
  target: string | null;
}

describe("deviation ledger (HTTP, real stack) — CAR-159 / ADR 0110", () => {
  let app: NestFastifyApplication;
  let db: Db;
  let tenant: TestUser;

  const post = (user: TestUser, url: string, payload?: Record<string, unknown>) =>
    inject(app, { method: "POST", url, headers: { cookie: user.cookie }, payload: payload ?? {} });
  const get = (user: TestUser, url: string) =>
    inject(app, { method: "GET", url, headers: { cookie: user.cookie } });
  const setRole = (userId: string, role: string) =>
    db.update(member).set({ role }).where(eq(member.userId, userId));

  async function orderFor(): Promise<{ orderId: string; quoteId: string }> {
    const quote = (await post(tenant, "/v1/quotes", issueBody)).json() as {
      id: string;
      shareToken: string;
    };
    await inject(app, { method: "POST", url: `/v1/quotes/shared/${quote.shareToken}/accept` });
    const order = (await post(tenant, "/v1/orders", { quoteId: quote.id })).json() as {
      id: string;
    };
    return { orderId: order.id, quoteId: quote.id };
  }

  beforeAll(async () => {
    app = await createApiApp();
    db = app.get<Db>(DB);
    tenant = await signUpUser(app, "ledger-tenant");
    await seedGoldenCorpusFor(app, db, tenant);
    expect((await post(tenant, "/v1/price-tables", priceTableBody)).statusCode).toBe(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it("records a production-time order exception and surfaces it on GET /ledger", async () => {
    const { orderId, quoteId } = await orderFor();
    const exc = await post(tenant, `/v1/orders/${orderId}/exceptions`, {
      reason: "substituted RAL 7016 for 9005",
      target: "material:RAL7016",
    });
    expect(exc.statusCode, exc.body).toBe(200);

    const ledger = (await get(tenant, `/v1/ledger?quoteId=${quoteId}`)).json() as {
      items: LedgerEntry[];
    };
    const row = ledger.items.find((e) => e.source === "order_exception");
    expect(row).toBeDefined();
    expect(row?.orderId).toBe(orderId);
    expect(row?.reason).toBe("substituted RAL 7016 for 9005");
    expect(row?.target).toBe("material:RAL7016");
  });

  it("cancelling an in-production order writes an order_exception (stranded material)", async () => {
    const { orderId, quoteId } = await orderFor();
    expect((await post(tenant, `/v1/orders/${orderId}/start`)).statusCode).toBe(200);
    expect(
      (await post(tenant, `/v1/orders/${orderId}/cancel`, { reason: "buyer cancelled mid-build" }))
        .statusCode,
    ).toBe(200);

    const ledger = (await get(tenant, `/v1/ledger?quoteId=${quoteId}`)).json() as {
      items: LedgerEntry[];
    };
    const row = ledger.items.find((e) => e.source === "order_exception" && e.orderId === orderId);
    expect(row?.reason).toBe("buyer cancelled mid-build");
  });

  it("is admin-only — workshop is 403 (the ledger carries margin values)", async () => {
    await setRole(tenant.id, "workshop");
    expect((await get(tenant, "/v1/ledger")).statusCode).toBe(403);
    await setRole(tenant.id, "admin");
  });

  it("rebuild re-projects the snapshot-derivable rows idempotently (0 for the golden corpus)", async () => {
    const first = await post(tenant, "/v1/quotes/rebuild-deviations");
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().projected).toBe(0); // goldens carry no quote-scope overrides
    const second = await post(tenant, "/v1/quotes/rebuild-deviations");
    expect(second.json().projected).toBe(0);
  });
});
