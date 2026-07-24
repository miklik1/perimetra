/**
 * The owner "Přehled" dashboard aggregate at the HTTP layer (ADR 0125) —
 * `GET /v1/me/dashboard-summary` against the real containers. One org, one user
 * whose `member.role` is flipped between cases (the roles.itest.ts idiom): flip
 * the role, assert the role-filtered shape.
 *
 * The matrix mirrors nav-counts:
 *   admin/sales → KPIs + funnel + expiring-quotes (with money) + activity
 *   workshop    → active-orders KPI + orders-only activity, NO quotes/funnel/
 *                 expiring, NO money anywhere (price-blind by absence, ADR 0056)
 *
 * Setup mirrors roles.itest.ts: a throwaway platform operator seeds + assigns the
 * golden corpus (publishing is vendor-only, ADR 0062), admin publishes this org's
 * price table, then issues ONE quote with a future `validUntil` so the expiring
 * widget/KPI are non-empty for the priced roles.
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
  createBuyerFor,
  inject,
  seedGoldenCorpusFor,
  signUpUser,
  type TestUser,
} from "./setup/app.js";

/** The golden three-instance site with a future validity window so the issued
 *  quote surfaces in the expiring-quotes widget + the "expiring soon" KPI —
 *  MINUS the buyer, which `beforeAll` folds in (mandatory since ADR 0126). */
const validUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
const baseIssueBody = {
  site: steppedSite,
  validUntil,
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
};

interface DashboardResponse {
  kpis: {
    activeOrders: number;
    openQuotes?: number;
    acceptedQuotes?: number;
    expiringSoon?: number;
  };
  funnel?: { quotes: number; orders: number };
  expiringQuotes?: Array<{ id: string; number: string | null; total: string | null }>;
  activity: Array<{ kind: string; id: string; status: string; updatedAt: string }>;
}

describe("owner dashboard summary (HTTP, real stack) — ADR 0125", () => {
  let app: NestFastifyApplication;
  let db: Db;
  let user: TestUser;

  const post = (u: TestUser, url: string, payload: Record<string, unknown>) =>
    inject(app, { method: "POST", url, headers: { cookie: u.cookie }, payload });
  const get = (u: TestUser, url: string) =>
    inject(app, { method: "GET", url, headers: { cookie: u.cookie } });
  const setRole = (role: string) =>
    db.update(member).set({ role }).where(eq(member.userId, user.id));

  beforeAll(async () => {
    app = await createApiApp();
    db = app.get<Db>(DB);
    user = await signUpUser(app, "dash-admin"); // owner → admin (org role)
    await seedGoldenCorpusFor(app, db, user);
    expect((await post(user, "/v1/price-tables", priceTableBody)).statusCode).toBe(201);
    const issueBody = { ...baseIssueBody, customerId: await createBuyerFor(app, user) };
    const issued = await post(user, "/v1/quotes", issueBody);
    expect(issued.statusCode, JSON.stringify(issued.json())).toBe(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it("admin: KPIs + funnel + expiring quotes carrying money + activity", async () => {
    await setRole("admin");
    const res = await get(user, "/v1/me/dashboard-summary");
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as DashboardResponse;

    expect(typeof body.kpis.activeOrders).toBe("number");
    expect(body.kpis.openQuotes).toBeGreaterThanOrEqual(1); // the issued quote
    // The honest 2-stage funnel reuses the counts.
    expect(body.funnel).toEqual({ quotes: body.kpis.openQuotes, orders: body.kpis.activeOrders });
    // The expiring widget lists the issued quote WITH its money (priced role).
    expect(body.expiringQuotes?.length).toBeGreaterThanOrEqual(1);
    expect(body.expiringQuotes?.[0]?.total).toBe("134723.5");
    // Activity shows the issued quote.
    expect(body.activity.some((a) => a.kind === "quote")).toBe(true);
  });

  it("sales: same priced shape (funnel + expiring + money present)", async () => {
    await setRole("sales");
    const res = await get(user, "/v1/me/dashboard-summary");
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as DashboardResponse;

    expect(body.funnel).toBeDefined();
    expect(body.kpis.openQuotes).toBeGreaterThanOrEqual(1);
    expect(body.expiringQuotes?.[0]?.total).toBe("134723.5");
  });

  it("workshop: active-orders KPI + activity only — no quotes/funnel/expiring, no money", async () => {
    await setRole("workshop");
    const res = await get(user, "/v1/me/dashboard-summary");
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as DashboardResponse;

    // ONLY the active-orders KPI — every quotes-derived key is absent.
    expect(Object.keys(body.kpis)).toEqual(["activeOrders"]);
    expect(body.funnel).toBeUndefined();
    expect(body.expiringQuotes).toBeUndefined();
    expect(Array.isArray(body.activity)).toBe(true);
    // No activity row is a quote (orders-only feed).
    expect(body.activity.every((a) => a.kind === "order")).toBe(true);
    // Belt-and-suspenders: the money never appears anywhere in the payload.
    expect(res.body).not.toContain("134723.5");
  });
});
