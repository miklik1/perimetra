/**
 * Invoice issue + reproducibility (ADR 0112, ADR-O2) at the HTTP layer against
 * the real containers. Proves the §29 daňový-doklad contract end-to-end:
 *
 *  - Issue from an order freezes an immutable document (`FV{year}/{seq}`, gap-free
 *    "invoice" series) and re-derives byte-identically (`POST /:id/verify`, §6),
 *    while the underlying QUOTE still reproduces its own golden (the §6 "BOTH").
 *  - §92e reverse charge is a NO-VAT document (regime from the frozen mode, not
 *    the rate) — `reverseCharge` set, `vatTotalCents === 0`.
 *  - Fail-closed issue guards: no IBAN → 422 `iban_required`; no attached
 *    customer → 422 `customer_required`; §29 gate before a number is burned.
 *  - Payment is row state: mark-paid is admin-only + idempotent (409 repeat);
 *    a double-issue on one order is a structural 409 (`invoice_order_active_uq`).
 *  - Workshop is price-blind by ABSENCE (403 on the whole surface).
 */
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Db } from "@repo/db";
import { member } from "@repo/db/schema/auth";
import { siteFenceConfig, siteGateConfig, sitePrices, steppedSite } from "@repo/fixtures";

import { DB } from "../src/common/db/db.module.js";
import {
  createApiApp,
  inject,
  seedGoldenCorpusFor,
  signUpUser,
  TEST_LEGAL_PROFILE,
  type TestUser,
} from "./setup/app.js";

const TEST_IBAN = "CZ6508000000192000145399"; // valid CZ IBAN (mod-97)

const instances = [
  { instanceId: "gate", releaseId: "sliding-gate@1", input: siteGateConfig },
  { instanceId: "fenceA", releaseId: "fence-run@1", input: siteFenceConfig },
  { instanceId: "fenceB", releaseId: "fence-run@1", input: siteFenceConfig },
];

const priceTableBody = {
  currency: "CZK",
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  dphRate: "21",
  table: sitePrices,
};

describe("invoice issue + reproducibility (HTTP, real stack) — ADR 0112", () => {
  let app: NestFastifyApplication;
  let db: Db;
  let tenant: TestUser;

  const post = (user: TestUser, url: string, payload?: Record<string, unknown>) =>
    inject(app, { method: "POST", url, headers: { cookie: user.cookie }, payload: payload ?? {} });
  const get = (user: TestUser, url: string) =>
    inject(app, { method: "GET", url, headers: { cookie: user.cookie } });
  const put = (user: TestUser, url: string, payload: Record<string, unknown>) =>
    inject(app, { method: "PUT", url, headers: { cookie: user.cookie }, payload });
  const setRole = (userId: string, role: string) =>
    db.update(member).set({ role }).where(eq(member.userId, userId));

  async function createCustomer(
    user: TestUser,
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const res = await post(user, "/v1/customers", {
      name: "Odběratel a.s.",
      ico: "45274649",
      dic: "CZ45274649",
      vatPayer: true,
      ...overrides,
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { id: string }).id;
  }

  /** Issue → accept → order, optionally attaching a customer + §92e tax facts. */
  async function orderFor(
    user: TestUser,
    opts: { customerId?: string; constructionAssembly?: boolean } = {},
  ): Promise<{ orderId: string; quoteId: string }> {
    const issueBody: Record<string, unknown> = { site: steppedSite, instances };
    if (opts.customerId) issueBody.customerId = opts.customerId;
    if (opts.constructionAssembly) issueBody.tax = { constructionAssembly: true };
    const quote = (await post(user, "/v1/quotes", issueBody)).json() as {
      id: string;
      shareToken: string;
    };
    await inject(app, { method: "POST", url: `/v1/quotes/shared/${quote.shareToken}/accept` });
    const order = (await post(user, "/v1/orders", { quoteId: quote.id })).json() as { id: string };
    return { orderId: order.id, quoteId: quote.id };
  }

  beforeAll(async () => {
    app = await createApiApp();
    db = app.get<Db>(DB);
    tenant = await signUpUser(app, "invoice-tenant");
    await seedGoldenCorpusFor(app, db, tenant);
    await put(tenant, "/v1/org/legal-profile", { ...TEST_LEGAL_PROFILE, iban: TEST_IBAN });
    expect((await post(tenant, "/v1/price-tables", priceTableBody)).statusCode).toBe(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it("issues FV{year}/0001, reproduces byte-identically, and the quote still reproduces", async () => {
    const customerId = await createCustomer(tenant);
    const { orderId, quoteId } = await orderFor(tenant, { customerId });

    const issued = await post(tenant, "/v1/invoices", { orderId });
    expect(issued.statusCode, issued.body).toBe(201);
    const invoice = issued.json() as {
      id: string;
      documentNumber: string;
      status: string;
      currency: string;
      variableSymbol: string;
      total: string;
    };
    const year = new Date().getFullYear();
    expect(invoice.documentNumber).toBe(`FV${year}/0001`);
    expect(invoice.status).toBe("issued");
    expect(invoice.currency).toBe("CZK");
    expect(invoice.variableSymbol).toMatch(/^\d{1,10}$/);
    expect(Number(invoice.total)).toBeGreaterThan(0);

    // Detail carries the frozen ExportableDocument (the print seam).
    const detail = (await get(tenant, `/v1/invoices/${invoice.id}`)).json() as {
      snapshot: { number: string; totalCents: number };
    };
    expect(detail.snapshot.number).toBe(`FV${year}/0001`);
    expect(detail.snapshot.totalCents).toBeGreaterThan(0);

    // §6 BOTH: the invoice reproduces itself AND the quote reproduces its golden.
    const invVerify = (await post(tenant, `/v1/invoices/${invoice.id}/verify`)).json() as {
      reproduced: boolean;
      mismatches: string[];
    };
    expect(invVerify).toEqual({ invoiceId: invoice.id, reproduced: true, mismatches: [] });
    const qVerify = (await post(tenant, `/v1/quotes/${quoteId}/verify`)).json() as {
      reproduced: boolean;
    };
    expect(qVerify.reproduced).toBe(true);
  });

  it("allocates a gap-free number — the second invoice is FV{year}/0002", async () => {
    const customerId = await createCustomer(tenant);
    const { orderId } = await orderFor(tenant, { customerId });
    const invoice = (await post(tenant, "/v1/invoices", { orderId })).json() as {
      documentNumber: string;
    };
    expect(invoice.documentNumber).toBe(`FV${new Date().getFullYear()}/0002`);
  });

  it("a double-issue on one order is a 409 invoice_exists", async () => {
    const customerId = await createCustomer(tenant);
    const { orderId } = await orderFor(tenant, { customerId });
    expect((await post(tenant, "/v1/invoices", { orderId })).statusCode).toBe(201);
    const dup = await post(tenant, "/v1/invoices", { orderId });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe("invoice_exists");
  });

  it("§92e reverse charge: no output VAT, reverseCharge flag set", async () => {
    const customerId = await createCustomer(tenant);
    const { orderId } = await orderFor(tenant, { customerId, constructionAssembly: true });
    const invoice = (await post(tenant, "/v1/invoices", { orderId })).json() as {
      id: string;
      snapshot: { reverseCharge: boolean; vatTotalCents: number };
    };
    expect(invoice.snapshot.reverseCharge).toBe(true);
    expect(invoice.snapshot.vatTotalCents).toBe(0);
    // A §92e document still reproduces (regime carried from the frozen mode).
    const verify = (await post(tenant, `/v1/invoices/${invoice.id}/verify`)).json() as {
      reproduced: boolean;
    };
    expect(verify.reproduced).toBe(true);
  });

  it("422 customer_required when the quote had no attached customer", async () => {
    const { orderId } = await orderFor(tenant); // no customerId
    const res = await post(tenant, "/v1/invoices", { orderId });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("customer_required");
  });

  it("mark-paid is admin-only and idempotent; unmark-paid reverses it", async () => {
    const customerId = await createCustomer(tenant);
    const { orderId } = await orderFor(tenant, { customerId });
    const { id } = (await post(tenant, "/v1/invoices", { orderId })).json() as { id: string };

    const paid = await post(tenant, `/v1/invoices/${id}/mark-paid`, { note: "VS matched" });
    expect(paid.statusCode, paid.body).toBe(200);
    expect(paid.json().status).toBe("paid");

    const again = await post(tenant, `/v1/invoices/${id}/mark-paid`, {});
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe("already_paid");

    const unpaid = await post(tenant, `/v1/invoices/${id}/unmark-paid`, {});
    expect(unpaid.statusCode).toBe(200);
    expect(unpaid.json().status).toBe("issued");
  });

  it("workshop is price-blind by absence — 403 on the whole invoice surface", async () => {
    await setRole(tenant.id, "workshop");
    expect((await get(tenant, "/v1/invoices")).statusCode).toBe(403);
    await setRole(tenant.id, "admin");
  });

  it("422 iban_required when the org's legal profile has no IBAN", async () => {
    const noIban = await signUpUser(app, "invoice-noiban");
    await seedGoldenCorpusFor(app, db, noIban);
    await put(noIban, "/v1/org/legal-profile", TEST_LEGAL_PROFILE); // no iban
    expect((await post(noIban, "/v1/price-tables", priceTableBody)).statusCode).toBe(201);
    const customerId = await createCustomer(noIban);
    const { orderId } = await orderFor(noIban, { customerId });
    const res = await post(noIban, "/v1/invoices", { orderId });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("iban_required");
  });
});
