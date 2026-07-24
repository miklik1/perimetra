/**
 * Quote revision / supersession (ADR 0109 / ADR-O1, CAR-158) at the HTTP layer
 * against the real containers. Proves: `POST /v1/quotes/:id/revise` issues a NEW
 * quote linked via `revisionOfId` and supersedes the old in the same tx (the new
 * number continues the gap-free series); the superseded quote's buyer token
 * REFUSES resolution (409 `quote_superseded`); re-revising a superseded quote
 * 409s (`quote_already_superseded`); and the revised quote still reproduces
 * byte-identically (I3 — supersession is a pointer move, the snapshot is frozen).
 */
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Db } from "@repo/db";
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
  createBuyerFor,
  inject,
  seedGoldenCorpusFor,
  signUpUser,
  type TestUser,
} from "./setup/app.js";

/** The issue body MINUS the buyer — an odběratel is mandatory at issue (and at
 *  REVISE, which re-runs the whole issue path) since ADR 0126, so `beforeAll`
 *  folds this org's own customer in (`issueBody`). */
const baseIssueBody = {
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
  status: string;
  revisionOfId: string | null;
  supersededById: string | null;
  total: string;
}

describe("quote revision / supersession (HTTP, real stack) — CAR-158 / ADR 0109", () => {
  let app: NestFastifyApplication;
  let db: Db;
  let tenant: TestUser;
  /** `baseIssueBody` + this org's odběratel (mandatory since ADR 0126). */
  let issueBody: Record<string, unknown>;

  const post = (user: TestUser, url: string, payload?: Record<string, unknown>) =>
    inject(app, { method: "POST", url, headers: { cookie: user.cookie }, payload: payload ?? {} });
  const get = (user: TestUser, url: string) =>
    inject(app, { method: "GET", url, headers: { cookie: user.cookie } });

  beforeAll(async () => {
    app = await createApiApp();
    db = app.get<Db>(DB);
    tenant = await signUpUser(app, "revise-tenant");
    await seedGoldenCorpusFor(app, db, tenant);
    expect((await post(tenant, "/v1/price-tables", priceTableBody)).statusCode).toBe(201);
    issueBody = { ...baseIssueBody, customerId: await createBuyerFor(app, tenant) };
  });

  afterAll(async () => {
    await app.close();
  });

  it("revise issues a linked new quote and supersedes the old (linear chain, continuing series)", async () => {
    const original = (await post(tenant, "/v1/quotes", issueBody)).json() as QuoteResponse;
    const revised = (
      await post(tenant, `/v1/quotes/${original.id}/revise`, issueBody)
    ).json() as QuoteResponse;

    expect(revised.revisionOfId).toBe(original.id);
    expect(revised.supersededById).toBeNull(); // the new head

    // The old quote now points forward to the revision.
    const reloadedOld = (await get(tenant, `/v1/quotes/${original.id}`)).json() as QuoteResponse;
    expect(reloadedOld.supersededById).toBe(revised.id);

    // The revision continues the same gap-free series (numbers strictly increase).
    const seq = (n: string) => Number(n.split("/")[1]);
    expect(seq(revised.documentNumber)).toBe(seq(original.documentNumber) + 1);
  });

  it("the superseded quote's buyer token REFUSES resolution (409 quote_superseded)", async () => {
    const original = (await post(tenant, "/v1/quotes", issueBody)).json() as QuoteResponse;
    await post(tenant, `/v1/quotes/${original.id}/revise`, issueBody);

    // The public buyer view still renders the old document, flagged superseded.
    const shared = await inject(app, {
      method: "GET",
      url: `/v1/quotes/shared/${original.shareToken}`,
    });
    expect(shared.statusCode).toBe(200);
    expect(shared.json().superseded).toBe(true);

    // But a forwarded stale link cannot accept/decline it.
    const accept = await inject(app, {
      method: "POST",
      url: `/v1/quotes/shared/${original.shareToken}/accept`,
    });
    expect(accept.statusCode).toBe(409);
    expect(accept.json().code).toBe("quote_superseded");
  });

  it("re-revising an already-superseded quote 409s (quote_already_superseded)", async () => {
    const original = (await post(tenant, "/v1/quotes", issueBody)).json() as QuoteResponse;
    expect((await post(tenant, `/v1/quotes/${original.id}/revise`, issueBody)).statusCode).toBe(
      201,
    );
    const again = await post(tenant, `/v1/quotes/${original.id}/revise`, issueBody);
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe("quote_already_superseded");
  });

  it("the revised quote reproduces byte-identically (I3 — supersession is a pointer, not a mutation)", async () => {
    const original = (await post(tenant, "/v1/quotes", issueBody)).json() as QuoteResponse;
    const revised = (
      await post(tenant, `/v1/quotes/${original.id}/revise`, issueBody)
    ).json() as QuoteResponse;

    const verify = await post(tenant, `/v1/quotes/${revised.id}/verify`);
    expect(verify.statusCode).toBe(200);
    expect(verify.json().reproduced).toBe(true);
    expect(verify.json().mismatches).toEqual([]);

    // And the superseded original still reproduces too (its snapshot is untouched).
    const verifyOld = await post(tenant, `/v1/quotes/${original.id}/verify`);
    expect(verifyOld.json().reproduced).toBe(true);
  });
});
