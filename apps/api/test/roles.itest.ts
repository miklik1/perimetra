/**
 * The RBAC role matrix at the HTTP layer against the real containers (ADR 0056).
 * One org, one user whose `member.role` is flipped between cases — zero code
 * between cases, the boot contract's bar: flip the role, assert the behaviour.
 *
 * The matrix (BE enforcement — the FE mirrors the SAME role from `/v1/me`):
 *   admin    → issues · publishes · sees prices · may override the margin floor
 *   sales    → issues · sees prices · publish 403 · no override
 *   workshop → price-blind reads (total null, snapshot money stripped) · issue 403
 *              · publish 403 · price-tables 403
 *
 * A second app pins the margin floor high to exercise the guard + admin override.
 */
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Db } from "@repo/db";
import { audit } from "@repo/db/schema/audit";
import { member } from "@repo/db/schema/auth";
import {
  catalogV2,
  fenceRunV1,
  siteCosts,
  siteFenceConfig,
  siteGateConfig,
  sitePrices,
  slidingGateV1,
  steppedSite,
} from "@repo/fixtures";

import { DB } from "../src/common/db/db.module.js";
import { createApiApp, inject, signUpUser, type TestUser } from "./setup/app.js";

/** The golden three-instance site, roster by release natural key. */
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

/** Same table with a floor pinned above any real margin (~39%) so the per-org
 *  guard always fires (ADR 0059) — replaces the old env/DI overrideProvider. */
const marginFloorPriceTableBody = { ...priceTableBody, marginFloorPct: "99" };

interface QuoteResponse {
  id: string;
  total: string | null;
  snapshot: { money?: unknown; costMoney?: unknown };
}

describe("RBAC role matrix (HTTP, real stack)", () => {
  let app: NestFastifyApplication;
  let db: Db;
  let user: TestUser;
  let quoteId: string;

  const post = (u: TestUser, url: string, payload: Record<string, unknown>) =>
    inject(app, { method: "POST", url, headers: { cookie: u.cookie }, payload });
  const get = (u: TestUser, url: string) =>
    inject(app, { method: "GET", url, headers: { cookie: u.cookie } });

  /** Flip the (sole-member) user's role in their own org — fresh per request. */
  const setRole = (role: string) =>
    db.update(member).set({ role }).where(eq(member.userId, user.id));

  beforeAll(async () => {
    app = await createApiApp();
    db = app.get<Db>(DB);
    user = await signUpUser(app, "rbac-admin"); // owner → admin

    // Global immutable stores (shared across itest files — tolerate a sibling's 409).
    expect([201, 409]).toContain(
      (await post(user, "/v1/catalog-versions", { body: catalogV2 })).statusCode,
    );
    for (const body of [slidingGateV1, fenceRunV1]) {
      expect([201, 409]).toContain(
        (await post(user, "/v1/releases", { catalogVersion: 2, body })).statusCode,
      );
    }
    // This org's price table (admin publishes it), then issue one quote to read back.
    expect((await post(user, "/v1/price-tables", priceTableBody)).statusCode).toBe(201);
    const issued = await post(user, "/v1/quotes", issueBody);
    expect(issued.statusCode, JSON.stringify(issued.json())).toBe(201);
    quoteId = (issued.json() as QuoteResponse).id;
  });

  afterAll(async () => {
    await app.close();
  });

  it("admin: issues, publishes, sees prices", async () => {
    await setRole("admin");

    const issued = await post(user, "/v1/quotes", issueBody);
    expect(issued.statusCode).toBe(201);
    expect((issued.json() as QuoteResponse).total).toBe("129891.504");

    const read = await get(user, `/v1/quotes/${quoteId}`);
    expect((read.json() as QuoteResponse).total).toBe("129891.504");

    // Re-publishing the same immutable release is a 409, but it PASSED the gate
    // (not a 403) — that is what proves admin may publish.
    expect(
      (await post(user, "/v1/releases", { catalogVersion: 2, body: slidingGateV1 })).statusCode,
    ).toBe(409);
    expect((await get(user, "/v1/price-tables")).statusCode).toBe(200);
  });

  it("sales: issues and sees prices, but cannot publish", async () => {
    await setRole("sales");

    expect((await post(user, "/v1/quotes", issueBody)).statusCode).toBe(201);
    const read = await get(user, `/v1/quotes/${quoteId}`);
    expect((read.json() as QuoteResponse).total).toBe("129891.504");

    expect(
      (await post(user, "/v1/releases", { catalogVersion: 2, body: slidingGateV1 })).statusCode,
    ).toBe(403);
    expect((await post(user, "/v1/catalog-versions", { body: catalogV2 })).statusCode).toBe(403);
    // Sales may read price tables but not publish them.
    expect((await get(user, "/v1/price-tables")).statusCode).toBe(200);
    expect((await post(user, "/v1/price-tables", priceTableBody)).statusCode).toBe(403);
  });

  it("workshop: price-blind reads, no issue, no publish, no price tables", async () => {
    await setRole("workshop");

    const read = await get(user, `/v1/quotes/${quoteId}`);
    expect(read.statusCode).toBe(200);
    const quote = read.json() as QuoteResponse;
    // The price is stripped SERVER-SIDE — total null, snapshot money + cost gone
    // (the blind whitelist drops cost too, ADR 0059).
    expect(quote.total).toBeNull();
    expect(quote.snapshot.money).toBeUndefined();
    expect(quote.snapshot.costMoney).toBeUndefined();

    expect((await post(user, "/v1/quotes", issueBody)).statusCode).toBe(403);
    expect(
      (await post(user, "/v1/releases", { catalogVersion: 2, body: slidingGateV1 })).statusCode,
    ).toBe(403);
    expect((await get(user, "/v1/price-tables")).statusCode).toBe(403);
  });
});

describe("margin-floor guard (per-org floor 99%, ADR 0059)", () => {
  let app: NestFastifyApplication;
  let db: Db;
  let user: TestUser;

  const post = (u: TestUser, url: string, payload: Record<string, unknown>) =>
    inject(app, { method: "POST", url, headers: { cookie: u.cookie }, payload });
  const setRole = (role: string) =>
    db.update(member).set({ role }).where(eq(member.userId, user.id));

  beforeAll(async () => {
    app = await createApiApp();
    db = app.get<Db>(DB);
    user = await signUpUser(app, "rbac-margin"); // owner → admin, own org
    // Releases/catalog are global (seeded by the matrix describe). This org
    // publishes its own price table with the floor pinned high (the floor is
    // now per-org data, ADR 0059 — no provider override).
    expect((await post(user, "/v1/price-tables", marginFloorPriceTableBody)).statusCode).toBe(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it("sales below floor is blocked (422, no override path)", async () => {
    await setRole("sales");
    const res = await post(user, "/v1/quotes", issueBody);
    expect(res.statusCode).toBe(422);
    expect((res.json() as { code: string }).code).toBe("margin_below_floor");
  });

  it("admin is blocked without override, allowed with an audited override", async () => {
    await setRole("admin");

    const blocked = await post(user, "/v1/quotes", issueBody);
    expect(blocked.statusCode).toBe(422);
    expect((blocked.json() as { code: string }).code).toBe("margin_below_floor");

    const allowed = await post(user, "/v1/quotes", {
      ...issueBody,
      marginOverride: { reason: "strategic account — approved" },
    });
    expect(allowed.statusCode, JSON.stringify(allowed.json())).toBe(201);
    const { id } = allowed.json() as QuoteResponse;

    // The override is on the audit ledger (CORE_SPEC §7 — the single approval mechanism).
    const rows = await db
      .select()
      .from(audit)
      .where(and(eq(audit.action, "quote.margin_override"), eq(audit.entityId, id)));
    expect(rows.length).toBe(1);
  });
});
