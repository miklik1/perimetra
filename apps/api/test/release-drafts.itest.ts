/**
 * Release-drafts resource (ADR 0068 Phase 3) at the HTTP layer against the real
 * containers. The MUTABLE author workspace behind the structured release editor:
 *
 *  - full CRUD lifecycle (create → get → autosave update → delete → 404);
 *  - the strip-guard contract (no ownerId/organizationId/deletedAt leak; list
 *    items carry no heavy `body`, detail does);
 *  - the TIER: vendor-only (`PlatformGuard`) + org-scoped — a tenant 403s, anon
 *    401s, and a platform operator in ANOTHER org cannot see the draft (no
 *    existence oracle);
 *  - keyset pagination across 25 rows;
 *  - Idempotency-Key replay through the real Redis.
 */
import { randomUUID } from "node:crypto";
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { type Db } from "@repo/db";

import { DB } from "../src/common/db/db.module.js";
import {
  createApiApp,
  inject,
  promotePlatformAdmin,
  signUpUser,
  type TestUser,
} from "./setup/app.js";

const ROOT = "/v1/platform/release-drafts";

interface DraftSummary {
  id: string;
  modelId: string;
  version: number;
  catalogVersion: number | null;
  baseReleaseId: string | null;
  createdAt: string;
  updatedAt: string;
}
interface DraftDetail extends DraftSummary {
  body: unknown;
}
interface PageBody {
  items: DraftSummary[];
  nextCursor: string | null;
}

describe("release-drafts resource (HTTP, real stack)", () => {
  let app: NestFastifyApplication;
  let db: Db;
  let vendor: TestUser; // platform operator (user.role='admin')
  let tenant: TestUser; // ordinary org member (no platform role)

  const create = (
    u: TestUser,
    payload: Record<string, unknown>,
    headers: Record<string, string> = {},
  ) =>
    inject(app, { method: "POST", url: ROOT, headers: { cookie: u.cookie, ...headers }, payload });

  beforeAll(async () => {
    app = await createApiApp();
    db = app.get<Db>(DB);
    vendor = await signUpUser(app, "rd-vendor");
    await promotePlatformAdmin(db, vendor.id);
    tenant = await signUpUser(app, "rd-tenant");
  });

  afterAll(async () => {
    await app.close();
  });

  describe("CRUD lifecycle (vendor)", () => {
    it("walks create → get → autosave update → delete → 404", async () => {
      const created = await create(vendor, {
        modelId: "sliding-gate",
        version: 2,
        catalogVersion: 2,
        body: { step: 1 },
      });
      expect(created.statusCode, JSON.stringify(created.json())).toBe(201);
      const draft = created.json() as DraftDetail;
      expect(draft).toMatchObject({
        modelId: "sliding-gate",
        version: 2,
        catalogVersion: 2,
        baseReleaseId: null,
      });
      expect(draft.body).toEqual({ step: 1 });
      // strip-guard: exactly the contract keys — no ownerId/organizationId/deletedAt.
      expect(Object.keys(draft).sort()).toEqual([
        "baseReleaseId",
        "body",
        "catalogVersion",
        "createdAt",
        "id",
        "modelId",
        "updatedAt",
        "version",
      ]);

      const got = await inject(app, {
        method: "GET",
        url: `${ROOT}/${draft.id}`,
        headers: { cookie: vendor.cookie },
      });
      expect(got.statusCode).toBe(200);
      expect((got.json() as DraftDetail).body).toEqual({ step: 1 });

      // autosave overwrites the body and bumps a denorm field.
      const updated = await inject(app, {
        method: "PATCH",
        url: `${ROOT}/${draft.id}`,
        headers: { cookie: vendor.cookie },
        payload: { version: 3, body: { step: 2 } },
      });
      expect(updated.statusCode).toBe(200);
      expect(updated.json()).toMatchObject({ version: 3 });
      expect((updated.json() as DraftDetail).body).toEqual({ step: 2 });

      const deleted = await inject(app, {
        method: "DELETE",
        url: `${ROOT}/${draft.id}`,
        headers: { cookie: vendor.cookie },
      });
      expect(deleted.statusCode).toBe(204);

      const gone = await inject(app, {
        method: "GET",
        url: `${ROOT}/${draft.id}`,
        headers: { cookie: vendor.cookie },
      });
      expect(gone.statusCode).toBe(404);
    });

    it("a blank draft (empty payload) is valid — defaults + empty body", async () => {
      const created = await create(vendor, {});
      expect(created.statusCode, JSON.stringify(created.json())).toBe(201);
      const draft = created.json() as DraftDetail;
      expect(draft).toMatchObject({
        modelId: "",
        version: 1,
        catalogVersion: null,
        baseReleaseId: null,
      });
      expect(draft.body).toEqual({});
    });

    it("rejects an out-of-range limit with the 422 envelope", async () => {
      const res = await inject(app, {
        method: "GET",
        url: `${ROOT}?limit=101`,
        headers: { cookie: vendor.cookie },
      });
      expect(res.statusCode).toBe(422);
      expect((res.json() as { code: string }).code).toBe("validation");
    });
  });

  describe("tier: vendor-only, org-scoped", () => {
    it("a tenant (no platform role) 403s; anonymous 401s", async () => {
      expect(
        (await inject(app, { method: "GET", url: ROOT, headers: { cookie: tenant.cookie } }))
          .statusCode,
      ).toBe(403);
      expect((await create(tenant, { modelId: "x", body: {} })).statusCode).toBe(403);
      expect((await inject(app, { method: "GET", url: ROOT })).statusCode).toBe(401);
    });

    it("a draft is invisible to a platform operator in another org (no oracle)", async () => {
      const other = await signUpUser(app, "rd-vendor-2");
      await promotePlatformAdmin(db, other.id);

      const created = await create(vendor, { modelId: "private", body: { secret: true } });
      const id = (created.json() as DraftDetail).id;

      // Read AND write 404 across the org boundary; never in the other's list.
      expect(
        (
          await inject(app, {
            method: "GET",
            url: `${ROOT}/${id}`,
            headers: { cookie: other.cookie },
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await inject(app, {
            method: "PATCH",
            url: `${ROOT}/${id}`,
            headers: { cookie: other.cookie },
            payload: { body: {} },
          })
        ).statusCode,
      ).toBe(404);
      const otherList = await inject(app, {
        method: "GET",
        url: ROOT,
        headers: { cookie: other.cookie },
      });
      expect((otherList.json() as PageBody).items.map((d) => d.id)).not.toContain(id);
    });
  });

  describe("keyset pagination", () => {
    let pager: TestUser;
    const ids: string[] = [];

    beforeAll(async () => {
      pager = await signUpUser(app, "rd-pager");
      await promotePlatformAdmin(db, pager.id);
      for (let i = 0; i < 25; i++) {
        const res = await create(pager, {
          modelId: `m-${String(i).padStart(2, "0")}`,
          body: { i },
        });
        expect(res.statusCode).toBe(201);
        ids.push((res.json() as DraftDetail).id);
      }
    });

    const listPage = async (query: string): Promise<PageBody> => {
      const res = await inject(app, {
        method: "GET",
        url: `${ROOT}?${query}`,
        headers: { cookie: pager.cookie },
      });
      expect(res.statusCode).toBe(200);
      return res.json() as PageBody;
    };

    it("walks 25 rows in 10/10/5 pages (default createdAt:desc), summaries only", async () => {
      const newestFirst = [...ids].reverse();

      const page1 = await listPage("limit=10");
      expect(page1.items.map((d) => d.id)).toEqual(newestFirst.slice(0, 10));
      expect(page1.nextCursor).toBe(newestFirst[9]);
      // List is the summary projection — no heavy body shipped per row.
      expect(page1.items[0]).not.toHaveProperty("body");

      const page2 = await listPage(`limit=10&cursor=${page1.nextCursor}`);
      expect(page2.items.map((d) => d.id)).toEqual(newestFirst.slice(10, 20));

      const page3 = await listPage(`limit=10&cursor=${page2.nextCursor}`);
      expect(page3.items.map((d) => d.id)).toEqual(newestFirst.slice(20, 25));
      expect(page3.nextCursor).toBeNull();
    });
  });

  describe("idempotency replay (real Redis)", () => {
    it("replays a POST with the same Idempotency-Key instead of re-executing", async () => {
      const idem = await signUpUser(app, "rd-idem");
      await promotePlatformAdmin(db, idem.id);
      const key = randomUUID();

      const first = await create(idem, { modelId: "once", body: {} }, { "idempotency-key": key });
      expect(first.statusCode).toBe(201);
      expect(first.headers["idempotency-replayed"]).toBeUndefined();
      const firstBody = first.json() as DraftDetail;

      const second = await create(idem, { modelId: "once", body: {} }, { "idempotency-key": key });
      expect(second.statusCode).toBe(201);
      expect(second.headers["idempotency-replayed"]).toBe("true");
      expect(second.json()).toEqual(firstBody);
    });
  });
});
