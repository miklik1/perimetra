/**
 * The quote lifecycle at the HTTP layer against the real containers (ADR 0053,
 * spec §14) — the I3 core. The load-bearing gate: a quote ISSUED from a site +
 * roster freezes a snapshot whose total is the site golden 129 891.504, and the
 * reproducibility check re-derives it BYTE-IDENTICALLY from its stamps (reloads
 * the immutable release/catalog/price-table versions, re-runs the pure engine +
 * renderers, deep-equals every artifact).
 */
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Db } from "@repo/db";
import { user as userTable } from "@repo/db/schema/auth";
import { quote as quoteTable } from "@repo/db/schema/quotes";
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
  setupLegalProfile,
  signUpUser,
  TEST_LEGAL_PROFILE,
  type TestUser,
} from "./setup/app.js";

interface QuoteDetail {
  id: string;
  customerId: string | null;
  status: string;
  documentNumber: string;
  currency: string;
  shareToken: string;
  validUntil: string | null;
  total: string;
  stamps: {
    releaseIds: Record<string, string>;
    catalogVersions: Record<string, number>;
    priceTableVersion: number;
  };
  snapshot: {
    money: { total: string };
    costMoney?: { total: string };
    /** The buyer identity FROZEN at issue (ADR 0086/0071) — captured, not re-derived. */
    customer?: {
      customerId: string;
      name: string;
      ico: string | null;
      dic: string | null;
      vatPayer: boolean;
      addressLine: string | null;
      city: string | null;
      postalCode: string | null;
      country: string;
    };
    /** The supplier (dodavatel) identity FROZEN at issue (ADR 0088) — captured. */
    supplier?: {
      name: string;
      ico: string | null;
      dic: string | null;
      vatPayer: boolean;
      addressLine: string | null;
      city: string | null;
      postalCode: string | null;
      country: string;
      bankAccount: string | null;
      registrationNote: string | null;
    };
    tax: {
      mode: string;
      legend?: string;
      currency: string;
      lines: { ratePct: string; netBase: string; vatAmount: string; gross: string }[];
      netTotal: string;
      vatTotal: string;
      grossTotal: string;
    };
  };
}

/** The active price table the quote stamps against — with a cost layer (ADR
 *  0059) so the snapshot freezes cost and verify re-derives it (I3). */
const priceTableBody = {
  currency: "CZK",
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  dphRate: "21",
  table: sitePrices,
  cost: siteCosts,
};

describe("quote lifecycle (HTTP, real stack)", () => {
  let app: NestFastifyApplication;
  let db: Db;
  let tenant: TestUser;

  const post = (user: TestUser, url: string, payload: Record<string, unknown>) =>
    inject(app, { method: "POST", url, headers: { cookie: user.cookie }, payload });

  /** The issue body: the golden three-instance site, roster by release natural key. */
  const issueBody = {
    site: steppedSite,
    instances: [
      { instanceId: "gate", releaseId: "sliding-gate@1", input: siteGateConfig },
      { instanceId: "fenceA", releaseId: "fence-run@1", input: siteFenceConfig },
      { instanceId: "fenceB", releaseId: "fence-run@1", input: siteFenceConfig },
    ],
  };

  beforeAll(async () => {
    app = await createApiApp();
    db = app.get<Db>(DB);
    tenant = await signUpUser(app, "quote-tenant");

    // Seed the GLOBAL immutable stores (catalog/releases — published by a platform
    // operator, ADR 0062) AND assign the corpus to this org so it can issue.
    await seedGoldenCorpusFor(app, db, tenant);
    // Active price table (open-ended window covering now) — org-admin publishes.
    expect((await post(tenant, "/v1/price-tables", priceTableBody)).statusCode).toBe(201);
  });

  afterAll(async () => {
    await app.close();
  });

  describe("issue", () => {
    it("freezes a snapshot at the site golden total 129 891.504 with full stamps", async () => {
      const res = await post(tenant, "/v1/quotes", issueBody);
      expect(res.statusCode, JSON.stringify(res.json())).toBe(201);
      const quote = res.json() as QuoteDetail;

      expect(quote.status).toBe("issued");
      expect(quote.currency).toBe("CZK");
      expect(quote.total).toBe("129891.5");
      expect(quote.snapshot.money.total).toBe("129891.5");
      // Cost-of-goods is frozen in the snapshot (ADR 0059) — verify re-derives it.
      expect(quote.snapshot.costMoney?.total).toBe("79039.86");
      expect(quote.stamps.releaseIds).toEqual({
        gate: "sliding-gate@1",
        fenceA: "fence-run@1",
        fenceB: "fence-run@1",
      });
      expect(quote.stamps.catalogVersions).toEqual({
        "sliding-gate@1": 2,
        "fence-run@1": 2,
      });
      expect(quote.stamps.priceTableVersion).toBe(2);
    });

    it("freezes the structured DPH tax breakdown (standard 21 %, ADR 0080)", async () => {
      const quote = (await post(tenant, "/v1/quotes", issueBody)).json() as QuoteDetail;
      // No tax conditions → standard VAT; the net is the re-baselined site total.
      expect(quote.snapshot.tax.mode).toBe("standard_vat");
      expect(quote.snapshot.tax.legend).toBeUndefined();
      expect(quote.snapshot.tax.netTotal).toBe("129891.5");
      expect(quote.snapshot.tax.vatTotal).toBe("27277.22"); // 129891.5 × 21% → haléř
      expect(quote.snapshot.tax.grossTotal).toBe("157168.72");
      expect(quote.snapshot.tax.lines).toEqual([
        { ratePct: "21", netBase: "129891.5", vatAmount: "27277.22", gross: "157168.72" },
      ]);
    });

    it("issues a §92e reverse-charge document — NO VAT line + mandatory legend", async () => {
      const quote = (
        await post(tenant, "/v1/quotes", {
          ...issueBody,
          tax: { customerVatPayer: true, constructionAssembly: true },
        })
      ).json() as QuoteDetail;
      expect(quote.snapshot.tax.mode).toBe("reverse_charge_92e");
      expect(quote.snapshot.tax.vatTotal).toBe("0");
      expect(quote.snapshot.tax.grossTotal).toBe("129891.5"); // gross == net
      expect(quote.snapshot.tax.lines[0]!.vatAmount).toBe("0");
      expect(quote.snapshot.tax.legend).toMatch(/§ ?92e/);
    });

    it("rejects a release that is not published (400)", async () => {
      const res = await post(tenant, "/v1/quotes", {
        ...issueBody,
        instances: [{ instanceId: "gate", releaseId: "ghost@9", input: siteGateConfig }],
      });
      expect(res.statusCode).toBe(400);
    });

    it("rejects an invalid site (422) — the engine is the gate (I5)", async () => {
      const tooSteep = {
        ...steppedSite,
        terrain: [
          { id: "s1", elevation_mm: 0 },
          { id: "s2", elevation_mm: 400 },
        ],
      };
      const res = await post(tenant, "/v1/quotes", { ...issueBody, site: tooSteep });
      expect(res.statusCode).toBe(422);
    });
  });

  describe("I3 reproducibility (the acceptance test)", () => {
    it("re-derives the issued quote byte-identically from its stamps", async () => {
      const issued = (await post(tenant, "/v1/quotes", issueBody)).json() as QuoteDetail;

      const verify = await inject(app, {
        method: "POST",
        url: `/v1/quotes/${issued.id}/verify`,
        headers: { cookie: tenant.cookie },
      });
      expect(verify.statusCode).toBe(200);
      expect(verify.json()).toEqual({ quoteId: issued.id, reproduced: true, mismatches: [] });
    });

    it("reproduces regardless of the caller's instance order (canonical sort, I3)", async () => {
      // Reversed caller order — without the canonical instance sort, JSONB key
      // reordering on re-derivation would flip the bom/sources/overrideIds array
      // order and false-negative the deep-equal.
      const reordered = { ...issueBody, instances: [...issueBody.instances].reverse() };
      const issued = (await post(tenant, "/v1/quotes", reordered)).json() as QuoteDetail;
      const verify = await inject(app, {
        method: "POST",
        url: `/v1/quotes/${issued.id}/verify`,
        headers: { cookie: tenant.cookie },
      });
      expect(verify.statusCode).toBe(200);
      expect(verify.json() as { reproduced: boolean; mismatches: string[] }).toEqual({
        quoteId: issued.id,
        reproduced: true,
        mismatches: [],
      });
    });
  });

  describe("document numbering (gap-free per-org/year series, ADR 0079)", () => {
    const year = new Date().getFullYear();

    it("assigns sequential, gap-free numbers; a failed issue consumes none", async () => {
      const org = await signUpUser(app, "quote-numbering");
      await seedGoldenCorpusFor(app, db, org);
      expect((await post(org, "/v1/price-tables", priceTableBody)).statusCode).toBe(201);

      const first = (await post(org, "/v1/quotes", issueBody)).json() as QuoteDetail;
      expect(first.documentNumber).toBe(`${year}/0001`);
      const second = (await post(org, "/v1/quotes", issueBody)).json() as QuoteDetail;
      expect(second.documentNumber).toBe(`${year}/0002`);

      // A failed issue (invalid site → 422) must NOT consume a number: allocation
      // lives INSIDE the issue tx (ADR 0079), so the next success is 0003, not 0004.
      const tooSteep = {
        ...steppedSite,
        terrain: [
          { id: "s1", elevation_mm: 0 },
          { id: "s2", elevation_mm: 400 },
        ],
      };
      expect((await post(org, "/v1/quotes", { ...issueBody, site: tooSteep })).statusCode).toBe(
        422,
      );

      const third = (await post(org, "/v1/quotes", issueBody)).json() as QuoteDetail;
      expect(third.documentNumber).toBe(`${year}/0003`);
    });

    it("numbers each org independently (the series is org-scoped)", async () => {
      const orgA = await signUpUser(app, "quote-numbering-a");
      await seedGoldenCorpusFor(app, db, orgA);
      expect((await post(orgA, "/v1/price-tables", priceTableBody)).statusCode).toBe(201);
      const a = (await post(orgA, "/v1/quotes", issueBody)).json() as QuoteDetail;
      expect(a.documentNumber).toBe(`${year}/0001`);

      const orgB = await signUpUser(app, "quote-numbering-b");
      await seedGoldenCorpusFor(app, db, orgB);
      expect((await post(orgB, "/v1/price-tables", priceTableBody)).statusCode).toBe(201);
      const b = (await post(orgB, "/v1/quotes", issueBody)).json() as QuoteDetail;
      // Independent counter — orgB also starts at 0001 despite orgA's quote.
      expect(b.documentNumber).toBe(`${year}/0001`);
    });

    it("serializes concurrent issues into distinct numbers (row-lock + unique-index backstop)", async () => {
      const org = await signUpUser(app, "quote-numbering-concurrent");
      await seedGoldenCorpusFor(app, db, org);
      expect((await post(org, "/v1/price-tables", priceTableBody)).statusCode).toBe(201);

      const [r1, r2] = await Promise.all([
        post(org, "/v1/quotes", issueBody),
        post(org, "/v1/quotes", issueBody),
      ]);
      expect(r1.statusCode).toBe(201);
      expect(r2.statusCode).toBe(201);
      const nums = [
        (r1.json() as QuoteDetail).documentNumber,
        (r2.json() as QuoteDetail).documentNumber,
      ].sort();
      expect(nums).toEqual([`${year}/0001`, `${year}/0002`]);
    });
  });

  describe("org-scope isolation (ADR 0055)", () => {
    it("a different org cannot read the quote (404, no existence oracle)", async () => {
      const issued = (await post(tenant, "/v1/quotes", issueBody)).json() as QuoteDetail;
      // A fresh user is auto-provisioned a SEPARATE org — so this is now an
      // org-boundary probe, not just a user one.
      const intruder = await signUpUser(app, "quote-intruder");
      const res = await inject(app, {
        method: "GET",
        url: `/v1/quotes/${issued.id}`,
        headers: { cookie: intruder.cookie },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("I3 durability (owner_id RESTRICT, ADR 0055)", () => {
    it("refuses to hard-delete a user who authored a quote (the frozen artifact survives)", async () => {
      // Fresh user so the destructive delete attempt can't poison the shared tenant.
      // Releases/catalog are GLOBAL (seeded above); the price table is per-org
      // (ADR 0055) so this fresh org needs its own before it can issue.
      const author = await signUpUser(app, "quote-author");
      // Fresh org: assign the corpus (ADR 0062) + its own price table before issuing.
      await seedGoldenCorpusFor(app, db, author);
      expect((await post(author, "/v1/price-tables", priceTableBody)).statusCode).toBe(201);
      const issued = (await post(author, "/v1/quotes", issueBody)).json() as QuoteDetail;
      expect(issued.total).toBe("129891.5");

      // owner_id is ON DELETE RESTRICT: deleting the author must fail at the FK,
      // proving the I3 commercial record cannot vanish with its creator.
      await expect(db.delete(userTable).where(eq(userTable.id, author.id))).rejects.toThrow();

      // And the quote is still there.
      const [row] = await db.select().from(quoteTable).where(eq(quoteTable.id, issued.id)).limit(1);
      expect(row?.id).toBe(issued.id);
    });
  });

  describe("lifecycle transitions (ADR 0083)", () => {
    const issue = async () => (await post(tenant, "/v1/quotes", issueBody)).json() as QuoteDetail;
    const read = async (id: string) =>
      (
        await inject(app, {
          method: "GET",
          url: `/v1/quotes/${id}`,
          headers: { cookie: tenant.cookie },
        })
      ).json() as QuoteDetail;
    const publicPost = (url: string) => inject(app, { method: "POST", url });

    it("a fresh quote is issued; the buyer accepts via shareToken (issued→accepted)", async () => {
      const q = await issue();
      expect(q.status).toBe("issued");
      const res = await publicPost(`/v1/quotes/shared/${q.shareToken}/accept`);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toEqual({ documentNumber: q.documentNumber, status: "accepted" });
      expect((await read(q.id)).status).toBe("accepted");
    });

    it("a second resolution is rejected (409 — not open)", async () => {
      const q = await issue();
      expect((await publicPost(`/v1/quotes/shared/${q.shareToken}/accept`)).statusCode).toBe(200);
      expect((await publicPost(`/v1/quotes/shared/${q.shareToken}/decline`)).statusCode).toBe(409);
    });

    it("the buyer can decline (issued→declined)", async () => {
      const q = await issue();
      const res = await publicPost(`/v1/quotes/shared/${q.shareToken}/decline`);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: "declined" });
      expect((await read(q.id)).status).toBe("declined");
    });

    it("a quote past validUntil reads as expired and cannot be accepted", async () => {
      const q = (
        await post(tenant, "/v1/quotes", {
          ...issueBody,
          validUntil: "2020-01-01T00:00:00.000Z",
        })
      ).json() as QuoteDetail;
      expect((await read(q.id)).status).toBe("expired"); // derived from validUntil
      expect((await publicPost(`/v1/quotes/shared/${q.shareToken}/accept`)).statusCode).toBe(409);
    });

    it("an unknown shareToken 404s", async () => {
      expect((await publicPost(`/v1/quotes/shared/no-such-token/accept`)).statusCode).toBe(404);
    });
  });

  describe("customer-identity freeze (ADR 0086 / 0071)", () => {
    const buyer = {
      name: "Stavby Vrata s.r.o.",
      ico: "27074358",
      dic: "CZ27074358",
      vatPayer: true,
      addressLine: "Průmyslová 12",
      city: "Brno",
      postalCode: "61200",
      country: "CZ",
    };
    const createCustomer = async (user: TestUser) =>
      (
        await inject(app, {
          method: "POST",
          url: "/v1/customers",
          headers: { cookie: user.cookie },
          payload: buyer,
        })
      ).json() as { id: string };
    const readQuote = async (user: TestUser, id: string) =>
      (
        await inject(app, {
          method: "GET",
          url: `/v1/quotes/${id}`,
          headers: { cookie: user.cookie },
        })
      ).json() as QuoteDetail;

    it("freezes the buyer identity into the immutable snapshot at issue", async () => {
      const customer = await createCustomer(tenant);
      const quote = (
        await post(tenant, "/v1/quotes", { ...issueBody, customerId: customer.id })
      ).json() as QuoteDetail;

      expect(quote.customerId).toBe(customer.id);
      expect(quote.snapshot.customer).toEqual({
        customerId: customer.id,
        name: "Stavby Vrata s.r.o.",
        ico: "27074358",
        dic: "CZ27074358",
        vatPayer: true,
        addressLine: "Průmyslová 12",
        city: "Brno",
        postalCode: "61200",
        country: "CZ",
      });
    });

    it("retains the frozen buyer after the live customer is Art.17-erased — without breaking I3", async () => {
      const customer = await createCustomer(tenant);
      const issued = (
        await post(tenant, "/v1/quotes", { ...issueBody, customerId: customer.id })
      ).json() as QuoteDetail;

      // Art.17 erase anonymizes the LIVE customer PII in place (ADR 0071).
      const del = await inject(app, {
        method: "DELETE",
        url: `/v1/customers/${customer.id}`,
        headers: { cookie: tenant.cookie },
      });
      expect(del.statusCode).toBe(204);
      // The live customer is now anonymized + soft-deleted → gone from scoped reads.
      const live = await inject(app, {
        method: "GET",
        url: `/v1/customers/${customer.id}`,
        headers: { cookie: tenant.cookie },
      });
      expect(live.statusCode).toBe(404);

      // ...but the issued daňový doklad keeps its frozen buyer (legal-obligation basis).
      const reread = await readQuote(tenant, issued.id);
      expect(reread.snapshot.customer?.name).toBe("Stavby Vrata s.r.o.");
      expect(reread.snapshot.customer?.dic).toBe("CZ27074358");

      // The freeze is a captured fact, NOT in the I3 checks — verify still reproduces.
      const verify = await inject(app, {
        method: "POST",
        url: `/v1/quotes/${issued.id}/verify`,
        headers: { cookie: tenant.cookie },
      });
      expect(verify.json()).toEqual({ quoteId: issued.id, reproduced: true, mismatches: [] });
    });

    it("auto-fills the §92e decision from the attached VAT-payer customer", async () => {
      const customer = await createCustomer(tenant);
      const quote = (
        await post(tenant, "/v1/quotes", {
          ...issueBody,
          customerId: customer.id,
          tax: { constructionAssembly: true },
        })
      ).json() as QuoteDetail;
      // customer.vatPayer === true + construction/assembly → reverse charge, no VAT line.
      expect(quote.snapshot.tax.mode).toBe("reverse_charge_92e");
      expect(quote.snapshot.tax.vatTotal).toBe("0");
    });
  });

  describe("supplier-identity freeze (ADR 0088)", () => {
    it("freezes the org legal profile as the supplier block at issue", async () => {
      const quote = (await post(tenant, "/v1/quotes", issueBody)).json() as QuoteDetail;
      // The dodavatel block is the org's legal profile, captured at issue.
      expect(quote.snapshot.supplier).toEqual({
        name: TEST_LEGAL_PROFILE.name,
        ico: TEST_LEGAL_PROFILE.ico,
        dic: TEST_LEGAL_PROFILE.dic,
        vatPayer: TEST_LEGAL_PROFILE.vatPayer,
        addressLine: TEST_LEGAL_PROFILE.addressLine,
        city: TEST_LEGAL_PROFILE.city,
        postalCode: TEST_LEGAL_PROFILE.postalCode,
        country: TEST_LEGAL_PROFILE.country,
        bankAccount: TEST_LEGAL_PROFILE.bankAccount,
        registrationNote: TEST_LEGAL_PROFILE.registrationNote,
      });
    });

    it("a later profile edit does NOT alter an already-issued document (I3)", async () => {
      const issued = (await post(tenant, "/v1/quotes", issueBody)).json() as QuoteDetail;
      expect(issued.snapshot.supplier?.name).toBe(TEST_LEGAL_PROFILE.name);

      // Edit the org's LIVE legal profile (rename the company).
      const edit = await inject(app, {
        method: "PUT",
        url: "/v1/org/legal-profile",
        headers: { cookie: tenant.cookie },
        payload: { ...TEST_LEGAL_PROFILE, name: "Renamed Vrata a.s." },
      });
      expect(edit.statusCode).toBe(200);

      // The issued daňový doklad keeps its FROZEN supplier (a captured fact, like
      // the buyer — it survives a since-edited org profile, ADR 0088).
      const reread = (
        await inject(app, {
          method: "GET",
          url: `/v1/quotes/${issued.id}`,
          headers: { cookie: tenant.cookie },
        })
      ).json() as QuoteDetail;
      expect(reread.snapshot.supplier?.name).toBe(TEST_LEGAL_PROFILE.name);

      // And verify still reproduces — the supplier is NOT in the I3 checks.
      const verify = await inject(app, {
        method: "POST",
        url: `/v1/quotes/${issued.id}/verify`,
        headers: { cookie: tenant.cookie },
      });
      expect(verify.json()).toEqual({ quoteId: issued.id, reproduced: true, mismatches: [] });

      // Restore the shared tenant's profile (defensive — this is the last block).
      await setupLegalProfile(app, tenant);
    });

    it("refuses to issue when the org has not completed its legal profile (422)", async () => {
      const noProfile = await signUpUser(app, "quote-no-profile");
      // Corpus assigned + a price table, but deliberately NO legal profile.
      await seedGoldenCorpusFor(app, db, noProfile, { legalProfile: false });
      expect((await post(noProfile, "/v1/price-tables", priceTableBody)).statusCode).toBe(201);

      const res = await post(noProfile, "/v1/quotes", issueBody);
      expect(res.statusCode).toBe(422);
      expect((res.json() as { code: string }).code).toBe("legal_profile_required");
    });
  });

  describe("buyer-facing public nabídka (ADR 0089)", () => {
    const publicGet = (url: string) => inject(app, { method: "GET", url });
    const publicPost = (url: string) => inject(app, { method: "POST", url });
    const buyer = {
      name: "Stavby Vrata s.r.o.",
      ico: "27074358",
      dic: "CZ27074358",
      vatPayer: true,
      addressLine: "Průmyslová 12",
      city: "Brno",
      postalCode: "61200",
      country: "CZ",
    };

    it("returns the built nabídka by shareToken — no session, full supplier + buyer blocks", async () => {
      const customer = (
        await inject(app, {
          method: "POST",
          url: "/v1/customers",
          headers: { cookie: tenant.cookie },
          payload: buyer,
        })
      ).json() as { id: string };
      const issued = (
        await post(tenant, "/v1/quotes", { ...issueBody, customerId: customer.id })
      ).json() as QuoteDetail;

      const res = await publicGet(`/v1/quotes/shared/${issued.shareToken}`);
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json() as {
        document: {
          documentNumber: string;
          supplier: { name: string } | null;
          customer: { name: string } | null;
          netTotal: string;
          lines: unknown[];
        };
        status: string;
      };
      expect(body.status).toBe("issued");
      expect(body.document.documentNumber).toBe(issued.documentNumber);
      expect(body.document.supplier?.name).toBe(TEST_LEGAL_PROFILE.name);
      expect(body.document.customer?.name).toBe("Stavby Vrata s.r.o.");
      expect(body.document.netTotal).toBe("129891.5");
      expect(body.document.lines.length).toBeGreaterThan(0);
    });

    it("NEVER leaks cost/margin, stamps, or re-derivation seeds to the unauthenticated buyer", async () => {
      const issued = (await post(tenant, "/v1/quotes", issueBody)).json() as QuoteDetail;
      const res = await publicGet(`/v1/quotes/shared/${issued.shareToken}`);
      expect(res.statusCode).toBe(200);
      // The cost golden (79039.86) + the cost/stamp/seed + workshop-internal keys
      // must be ABSENT — the boundary returns ONLY the buyer document (ADR 0089).
      expect(res.body).not.toContain("79039.86");
      expect(res.body).not.toContain("costMoney");
      expect(res.body).not.toContain("costTotals");
      expect(res.body).not.toContain("stamps");
      expect(res.body).not.toContain("releaseIds");
      expect(res.body).not.toContain("catalogVersions");
      expect(res.body).not.toContain("priceTableVersion");
      expect(res.body).not.toContain("overrideIds");
      expect(res.body).not.toContain("cutList");
      expect(res.body).not.toContain("drawings");
      expect(res.body).not.toContain("cutOptions");
      expect(res.body).not.toContain('"inputs"');
    });

    it("still serves the document after the buyer resolves it (accepted → 200, not 409)", async () => {
      const issued = (await post(tenant, "/v1/quotes", issueBody)).json() as QuoteDetail;
      expect((await publicPost(`/v1/quotes/shared/${issued.shareToken}/accept`)).statusCode).toBe(
        200,
      );
      const res = await publicGet(`/v1/quotes/shared/${issued.shareToken}`);
      expect(res.statusCode).toBe(200);
      expect((res.json() as { status: string }).status).toBe("accepted");
    });

    it("serves an expired quote's document with status 'expired'", async () => {
      const issued = (
        await post(tenant, "/v1/quotes", { ...issueBody, validUntil: "2020-01-01T00:00:00.000Z" })
      ).json() as QuoteDetail;
      const res = await publicGet(`/v1/quotes/shared/${issued.shareToken}`);
      expect(res.statusCode).toBe(200);
      expect((res.json() as { status: string }).status).toBe("expired");
    });

    it("an unknown shareToken 404s", async () => {
      expect((await publicGet(`/v1/quotes/shared/no-such-token`)).statusCode).toBe(404);
    });
  });
});
