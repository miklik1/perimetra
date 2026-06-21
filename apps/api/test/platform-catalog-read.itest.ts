/**
 * Platform catalog-version GLOBAL detail read (`GET /v1/platform/catalog-versions/:id`,
 * ADR 0068 Phase 2) at the HTTP layer against the real containers. This route
 * backs the structured release editor's catalog-aware pickers: the editor runs
 * on `/platform` (the operator may be org-less), so it needs a platform-tier read
 * of the immutable catalog body — the tenant `GET /v1/catalog-versions/:id` is
 * `RolesGuard`-gated and would 403 an org-less operator.
 *
 * Catalog versions are GLOBAL + immutable (no per-org gate), so the platform read
 * is the same load as the tenant read; what this proves is the TIER:
 *  - a platform operator gets the full catalog body (materials/sections/components)
 *    by surrogate id;
 *  - unknown uuid → 404, non-uuid → 400 (ParseUUIDPipe);
 *  - it is platform-only — a tenant user 403s, anonymous 401s.
 */
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Db } from "@repo/db";
import { catalogVersion } from "@repo/db/schema/catalog-versions";
import { catalogV2 } from "@repo/fixtures";

import { DB } from "../src/common/db/db.module.js";
import {
  createApiApp,
  inject,
  promotePlatformAdmin,
  signUpUser,
  type TestUser,
} from "./setup/app.js";

describe("platform catalog-version detail read (HTTP, real stack)", () => {
  let app: NestFastifyApplication;
  let db: Db;
  let platform: TestUser; // the vendor (user.role='admin')
  let tenant: TestUser; // an ordinary org member (no platform role)
  let catalogV2RowId: string; // surrogate uuid of catalog@2

  const getAs = (u: TestUser, url: string) =>
    inject(app, { method: "GET", url, headers: { cookie: u.cookie } });

  beforeAll(async () => {
    app = await createApiApp();
    db = app.get<Db>(DB);
    platform = await signUpUser(app, "pc-platform");
    await promotePlatformAdmin(db, platform.id);
    tenant = await signUpUser(app, "pc-tenant");

    // Publish catalog@2 (tolerate 409 — the store is global/append-only across itests).
    expect([201, 409]).toContain(
      (
        await inject(app, {
          method: "POST",
          url: "/v1/catalog-versions",
          headers: { cookie: platform.cookie },
          payload: { body: catalogV2 },
        })
      ).statusCode,
    );
    const [row] = await db
      .select()
      .from(catalogVersion)
      .where(eq(catalogVersion.version, catalogV2.version));
    catalogV2RowId = row!.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns the full catalog body (materials/sections/components) by surrogate id", async () => {
    const res = await getAs(platform, `/v1/platform/catalog-versions/${catalogV2RowId}`);
    expect(res.statusCode, JSON.stringify(res.json())).toBe(200);
    const detail = res.json() as {
      version: number;
      body: { id: string; materials: unknown[]; sections: unknown[]; components: unknown[] };
    };
    expect(detail.version).toBe(catalogV2.version);
    expect(detail.body.id).toBe(catalogV2.id);
    expect(Array.isArray(detail.body.materials)).toBe(true);
    expect(Array.isArray(detail.body.sections)).toBe(true);
    expect(Array.isArray(detail.body.components)).toBe(true);
    // Enough options for a picker to be useful (the corpus catalog is non-empty).
    expect(detail.body.components.length).toBeGreaterThan(0);
  });

  it("lists published catalog versions (the picker source) including catalog@2", async () => {
    const res = await getAs(platform, "/v1/platform/catalog-versions");
    expect(res.statusCode, JSON.stringify(res.json())).toBe(200);
    const page = res.json() as { items: { id: string; version: number }[] };
    expect(page.items.some((i) => i.version === catalogV2.version && i.id === catalogV2RowId)).toBe(
      true,
    );
  });

  it("404s an unknown uuid, 400s a non-uuid id", async () => {
    expect(
      (await getAs(platform, "/v1/platform/catalog-versions/00000000-0000-4000-8000-000000000000"))
        .statusCode,
    ).toBe(404);
    expect((await getAs(platform, "/v1/platform/catalog-versions/not-a-uuid")).statusCode).toBe(
      400,
    );
  });

  it("is platform-only: a tenant user 403s, anonymous 401s", async () => {
    expect(
      (await getAs(tenant, `/v1/platform/catalog-versions/${catalogV2RowId}`)).statusCode,
    ).toBe(403);
    expect(
      (await inject(app, { method: "GET", url: `/v1/platform/catalog-versions/${catalogV2RowId}` }))
        .statusCode,
    ).toBe(401);
  });
});
