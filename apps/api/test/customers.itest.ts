/**
 * Customers + per-rep ownership (ADR 0082) against the real containers:
 *  - CRUD over HTTP (org-scoped);
 *  - PER-REP isolation: a sales rep sees only their own customers, admin sees all;
 *  - customer attach + §92e VAT-status auto-fill into the frozen quote;
 *  - GDPR "forget" anonymizes the buyer in place — the issued quote still
 *    re-derives byte-identically (I3).
 */
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Db } from "@repo/db";
import { member } from "@repo/db/schema/auth";
import { customer } from "@repo/db/schema/customers";
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
  orgIdOf,
  seedGoldenCorpusFor,
  signUpUser,
  type TestUser,
} from "./setup/app.js";

const priceTableBody = {
  currency: "CZK",
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  dphRate: "21",
  table: sitePrices,
  cost: siteCosts,
};

const issueBody = {
  site: steppedSite,
  instances: [
    { instanceId: "gate", releaseId: "sliding-gate@1", input: siteGateConfig },
    { instanceId: "fenceA", releaseId: "fence-run@1", input: siteFenceConfig },
    { instanceId: "fenceB", releaseId: "fence-run@1", input: siteFenceConfig },
  ],
};

interface CustomerBody {
  id: string;
  name: string;
  vatPayer: boolean;
  dic: string | null;
}

describe("customers + per-rep ownership (HTTP, real stack)", () => {
  let app: NestFastifyApplication;
  let db: Db;
  let user: TestUser;
  let orgId: string;

  const as = (
    u: TestUser,
    method: "GET" | "POST" | "PATCH" | "DELETE",
    url: string,
    payload?: Record<string, unknown>,
  ) =>
    inject(app, { method, url, headers: { cookie: u.cookie }, payload } as Parameters<
      typeof inject
    >[1]);
  const setRole = (u: TestUser, role: string) =>
    db.update(member).set({ role }).where(eq(member.userId, u.id));

  beforeAll(async () => {
    app = await createApiApp();
    db = app.get<Db>(DB);
    user = await signUpUser(app, "cust-tenant");
    orgId = await orgIdOf(db, user.id);
    await seedGoldenCorpusFor(app, db, user);
    expect((await as(user, "POST", "/v1/price-tables", priceTableBody)).statusCode).toBe(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it("creates + reads a customer (org-scoped)", async () => {
    const res = await as(user, "POST", "/v1/customers", {
      name: "Bartek Vrata s.r.o.",
      ico: "27074358",
      dic: "CZ27074358",
      vatPayer: true,
      city: "Brno",
    });
    expect(res.statusCode, JSON.stringify(res.json())).toBe(201);
    const created = res.json() as CustomerBody;
    expect(created.vatPayer).toBe(true);
    expect((created as unknown as Record<string, unknown>).ownerId).toBeUndefined(); // stripped

    const got = (await as(user, "GET", `/v1/customers/${created.id}`)).json() as CustomerBody;
    expect(got.name).toBe("Bartek Vrata s.r.o.");
  });

  it("a sales rep sees only their OWN customers; admin sees all", async () => {
    // A customer owned by a DIFFERENT rep in the SAME org (insert directly — the
    // FK needs a real user row, so borrow a second sign-up's id).
    const other = await signUpUser(app, "cust-other-rep");
    await db
      .insert(customer)
      .values({ ownerId: other.id, organizationId: orgId, name: "Another rep's client" });
    // And one owned by `user`.
    const mine = (
      await as(user, "POST", "/v1/customers", { name: "My client" })
    ).json() as CustomerBody;

    await setRole(user, "sales");
    const salesList = (await as(user, "GET", "/v1/customers?limit=100")).json() as {
      items: CustomerBody[];
    };
    const salesNames = salesList.items.map((c) => c.name);
    expect(salesNames).toContain("My client");
    expect(salesNames).not.toContain("Another rep's client");

    // ...and a direct read of the other rep's customer 404s (no oracle).
    const [otherRow] = await db
      .select({ id: customer.id })
      .from(customer)
      .where(eq(customer.ownerId, other.id))
      .limit(1);
    expect((await as(user, "GET", `/v1/customers/${otherRow!.id}`)).statusCode).toBe(404);

    await setRole(user, "admin");
    const adminList = (await as(user, "GET", "/v1/customers?limit=100")).json() as {
      items: CustomerBody[];
    };
    expect(adminList.items.map((c) => c.name)).toEqual(
      expect.arrayContaining(["My client", "Another rep's client"]),
    );
    expect(mine.id).toBeTruthy();
  });

  it("search filters by name OR IČO (case-insensitive substring, CAR-23)", async () => {
    const created = (
      await as(user, "POST", "/v1/customers", { name: "Zeta Vrátka Unique s.r.o." })
    ).json() as CustomerBody;

    // Case-insensitive substring on name — matches only the freshly created row.
    const byName = (
      await as(user, "GET", `/v1/customers?search=${encodeURIComponent("zeta vrátka")}`)
    ).json() as { items: CustomerBody[] };
    expect(byName.items.map((c) => c.id)).toEqual([created.id]);

    // Substring on IČO — matches the earlier "Bartek Vrata s.r.o." (ico 27074358).
    const byIco = (await as(user, "GET", "/v1/customers?search=270743")).json() as {
      items: CustomerBody[];
    };
    expect(byIco.items.map((c) => c.name)).toContain("Bartek Vrata s.r.o.");
    expect(byIco.items.map((c) => c.id)).not.toContain(created.id);

    // A term matching nothing returns an empty page.
    const none = (
      await as(user, "GET", `/v1/customers?search=${encodeURIComponent("no-such-substring-zzz")}`)
    ).json() as { items: CustomerBody[] };
    expect(none.items).toEqual([]);
  });

  it("attaches a customer and auto-fills the §92e decision from its VAT status", async () => {
    const cust = (
      await as(user, "POST", "/v1/customers", {
        name: "Plátce DPH s.r.o.",
        dic: "CZ27074358",
        vatPayer: true,
      })
    ).json() as CustomerBody;

    const quote = (
      await as(user, "POST", "/v1/quotes", {
        ...issueBody,
        customerId: cust.id,
        tax: { constructionAssembly: true },
      })
    ).json() as { id: string; customerId: string; snapshot: { tax: { mode: string } } };

    expect(quote.customerId).toBe(cust.id);
    // Both parties VAT payers + construction scope → §92e reverse charge.
    expect(quote.snapshot.tax.mode).toBe("reverse_charge_92e");
  });

  it("anonymizes a buyer in place — the issued quote still re-derives (I3)", async () => {
    const cust = (
      await as(user, "POST", "/v1/customers", { name: "Smazat Mě s.r.o.", vatPayer: false })
    ).json() as CustomerBody;
    const quote = (
      await as(user, "POST", "/v1/quotes", { ...issueBody, customerId: cust.id })
    ).json() as { id: string };

    // GDPR "forget" — anonymize + archive (never a hard delete; the quote's
    // customer_id is RESTRICT).
    expect((await as(user, "DELETE", `/v1/customers/${cust.id}`)).statusCode).toBe(204);
    expect((await as(user, "GET", `/v1/customers/${cust.id}`)).statusCode).toBe(404); // archived
    // The live row survives, PII scrubbed (RESTRICT held — no cascade delete).
    const [row] = await db
      .select({ name: customer.name })
      .from(customer)
      .where(eq(customer.id, cust.id))
      .limit(1);
    expect(row?.name).toBe("[erased]");

    // The issued quote re-derives byte-identically — the tax MODE was frozen, so
    // re-derivation never re-reads the now-anonymized customer (I3).
    const verify = await as(user, "POST", `/v1/quotes/${quote.id}/verify`);
    expect(verify.statusCode).toBe(200);
    expect(verify.json()).toEqual({ quoteId: quote.id, reproduced: true, mismatches: [] });
  });
});
