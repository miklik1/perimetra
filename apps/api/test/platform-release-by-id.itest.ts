/**
 * Platform release read by NATURAL key (`GET /v1/platform/releases/by-release-id/:releaseId`,
 * ADR 0068 Phase 3D) at the HTTP layer against the real containers. Backs the
 * structured editor's clone diff: a draft carries its source `baseReleaseId`
 * (the "modelId@version" natural key), and the diff needs the source body.
 *
 * Status-agnostic + global (I3, like the surrogate-id global read ADR 0067), so
 * this proves the TIER + the natural-key lookup: a platform operator gets the
 * full body by natural key; an unknown key 404s; tenant 403s, anonymous 401s.
 */
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Db } from "@repo/db";
import { catalogV1, slidingGateV1 } from "@repo/fixtures";
import { type ProductModelRelease } from "@repo/model";

import { DB } from "../src/common/db/db.module.js";
import {
  createApiApp,
  inject,
  promotePlatformAdmin,
  signUpUser,
  type TestUser,
} from "./setup/app.js";

/** A unique-keyed copy so it can coexist with whatever else the global,
 *  append-only release store holds across the itest suite. */
const release: ProductModelRelease = {
  ...slidingGateV1,
  id: "sliding-gate-byid@1",
  modelId: "sliding-gate-byid",
  version: 1,
};
const KEY = encodeURIComponent(release.id);

describe("platform release by natural key (HTTP, real stack)", () => {
  let app: NestFastifyApplication;
  let db: Db;
  let platform: TestUser;
  let tenant: TestUser;

  const getAs = (u: TestUser, url: string) =>
    inject(app, { method: "GET", url, headers: { cookie: u.cookie } });

  beforeAll(async () => {
    app = await createApiApp();
    db = app.get<Db>(DB);
    platform = await signUpUser(app, "byid-platform");
    await promotePlatformAdmin(db, platform.id);
    tenant = await signUpUser(app, "byid-tenant");

    // Catalog + release (global, append-only — tolerate 409 across itests).
    expect([201, 409]).toContain(
      (
        await inject(app, {
          method: "POST",
          url: "/v1/catalog-versions",
          headers: { cookie: platform.cookie },
          payload: { body: catalogV1 },
        })
      ).statusCode,
    );
    expect([201, 409]).toContain(
      (
        await inject(app, {
          method: "POST",
          url: "/v1/releases",
          headers: { cookie: platform.cookie },
          payload: { catalogVersion: 1, body: release },
        })
      ).statusCode,
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns the full release body by natural key (global, status-agnostic)", async () => {
    const res = await getAs(platform, `/v1/platform/releases/by-release-id/${KEY}`);
    expect(res.statusCode, JSON.stringify(res.json())).toBe(200);
    const detail = res.json() as {
      releaseId: string;
      modelId: string;
      version: number;
      body: { id: string };
    };
    expect(detail.releaseId).toBe(release.id);
    expect(detail.modelId).toBe(release.modelId);
    expect(detail.body.id).toBe(release.id);
  });

  it("404s an unknown natural key", async () => {
    expect(
      (await getAs(platform, `/v1/platform/releases/by-release-id/${encodeURIComponent("nope@9")}`))
        .statusCode,
    ).toBe(404);
  });

  it("is platform-only: a tenant 403s, anonymous 401s", async () => {
    const url = `/v1/platform/releases/by-release-id/${KEY}`;
    expect((await getAs(tenant, url)).statusCode).toBe(403);
    expect((await inject(app, { method: "GET", url })).statusCode).toBe(401);
  });
});
