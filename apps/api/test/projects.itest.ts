/**
 * The reference resource at the HTTP layer (spec §14, §7.8) against the real
 * containers: full CRUD, the 422 validation envelope, keyset pagination
 * across 25 rows, scope isolation between two users, and Idempotency-Key
 * replay through the real Redis.
 *
 * Each concern uses a FRESH user — projects are owner-scoped, so a fresh
 * user is a clean, isolated dataset by construction.
 */
import { randomUUID } from "node:crypto";
import { type NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApiApp, inject, signUpUser, type TestUser } from "./setup/app.js";

interface ProjectBody {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
}

interface PageBody {
  items: ProjectBody[];
  nextCursor: string | null;
}

describe("projects resource (HTTP, real stack)", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createApiApp();
  });

  afterAll(async () => {
    await app.close();
  });

  function createProject(
    user: TestUser,
    payload: Record<string, unknown>,
    headers: Record<string, string> = {},
  ) {
    return inject(app, {
      method: "POST",
      url: "/v1/projects",
      headers: { cookie: user.cookie, ...headers },
      payload,
    });
  }

  describe("CRUD", () => {
    let user: TestUser;

    beforeAll(async () => {
      user = await signUpUser(app, "projects-crud");
    });

    it("walks the full lifecycle: create → get → update → archive → delete → 404", async () => {
      // create — 201, response is the STRIPPED contract shape (no ownerId,
      // no deletedAt: the @ZodSerializerDto leak-guard, spec §8).
      const created = await createProject(user, { name: "Alpha", description: "first" });
      expect(created.statusCode).toBe(201);
      const project = created.json() as ProjectBody;
      expect(project).toMatchObject({ name: "Alpha", description: "first", status: "active" });
      expect(Object.keys(project).sort()).toEqual([
        "createdAt",
        "description",
        "id",
        "name",
        "status",
        "updatedAt",
      ]);

      // get
      const fetched = await inject(app, {
        method: "GET",
        url: `/v1/projects/${project.id}`,
        headers: { cookie: user.cookie },
      });
      expect(fetched.statusCode).toBe(200);
      expect(fetched.json()).toMatchObject({ id: project.id, name: "Alpha" });

      // update
      const updated = await inject(app, {
        method: "PATCH",
        url: `/v1/projects/${project.id}`,
        headers: { cookie: user.cookie },
        payload: { name: "Alpha v2" },
      });
      expect(updated.statusCode).toBe(200);
      expect(updated.json()).toMatchObject({ id: project.id, name: "Alpha v2" });

      // archive
      const archived = await inject(app, {
        method: "POST",
        url: `/v1/projects/${project.id}/archive`,
        headers: { cookie: user.cookie },
      });
      expect(archived.statusCode).toBe(200);
      expect(archived.json()).toMatchObject({ id: project.id, status: "archived" });

      // delete (soft) — 204, then the resource 404s
      const deleted = await inject(app, {
        method: "DELETE",
        url: `/v1/projects/${project.id}`,
        headers: { cookie: user.cookie },
      });
      expect(deleted.statusCode).toBe(204);

      const gone = await inject(app, {
        method: "GET",
        url: `/v1/projects/${project.id}`,
        headers: { cookie: user.cookie },
      });
      expect(gone.statusCode).toBe(404);
    });

    it("rejects invalid input with the 422 validation envelope", async () => {
      const response = await createProject(user, { name: "", description: 42 });

      expect(response.statusCode).toBe(422);
      const body = response.json() as {
        message: string;
        code: string;
        errors: Record<string, string[]>;
      };
      expect(body.message).toBe("Validation failed");
      expect(body.code).toBe("validation");
      expect(Array.isArray(body.errors["name"])).toBe(true);
      expect(Array.isArray(body.errors["description"])).toBe(true);
    });

    it("requires authentication (401 without a session)", async () => {
      const response = await inject(app, { method: "GET", url: "/v1/projects" });
      expect(response.statusCode).toBe(401);
    });
  });

  describe("keyset pagination", () => {
    let user: TestUser;
    /** Creation order — uuidv7 ids are monotonic, so this IS id order. */
    const createdIds: string[] = [];

    beforeAll(async () => {
      user = await signUpUser(app, "projects-pagination");
      for (let i = 0; i < 25; i++) {
        const response = await createProject(user, { name: `Paged ${String(i).padStart(2, "0")}` });
        expect(response.statusCode).toBe(201);
        createdIds.push((response.json() as ProjectBody).id);
      }
    });

    async function listPage(query: string): Promise<PageBody> {
      const response = await inject(app, {
        method: "GET",
        url: `/v1/projects?${query}`,
        headers: { cookie: user.cookie },
      });
      expect(response.statusCode).toBe(200);
      return response.json() as PageBody;
    }

    it("walks 25 rows in 10/10/5 pages (default createdAt:desc)", async () => {
      const newestFirst = [...createdIds].reverse();

      const page1 = await listPage("limit=10");
      expect(page1.items.map((p) => p.id)).toEqual(newestFirst.slice(0, 10));
      expect(page1.nextCursor).toBe(newestFirst[9]);

      const page2 = await listPage(`limit=10&cursor=${page1.nextCursor}`);
      expect(page2.items.map((p) => p.id)).toEqual(newestFirst.slice(10, 20));
      expect(page2.nextCursor).toBe(newestFirst[19]);

      const page3 = await listPage(`limit=10&cursor=${page2.nextCursor}`);
      expect(page3.items.map((p) => p.id)).toEqual(newestFirst.slice(20, 25));
      expect(page3.nextCursor).toBeNull();

      // No overlap, no loss: the three pages are exactly the 25 created rows.
      const seen = [...page1.items, ...page2.items, ...page3.items].map((p) => p.id);
      expect(new Set(seen).size).toBe(25);
    });

    it("supports ascending sort with the same cursor mechanics", async () => {
      const page = await listPage("limit=5&sort=createdAt:asc");
      expect(page.items.map((p) => p.id)).toEqual(createdIds.slice(0, 5));
      expect(page.nextCursor).toBe(createdIds[4]);

      const next = await listPage(`limit=5&sort=createdAt:asc&cursor=${page.nextCursor}`);
      expect(next.items.map((p) => p.id)).toEqual(createdIds.slice(5, 10));
    });

    it("rejects an out-of-range limit with 422", async () => {
      const response = await inject(app, {
        method: "GET",
        url: "/v1/projects?limit=101",
        headers: { cookie: user.cookie },
      });
      expect(response.statusCode).toBe(422);
      expect((response.json() as { code: string }).code).toBe("validation");
    });
  });

  // ADR 0055: each fresh user is auto-provisioned its own org, so this is now
  // an ORG-boundary probe (the scope flipped from owner to organization).
  describe("scope isolation", () => {
    let owner: TestUser;
    let intruder: TestUser;
    let projectId: string;

    beforeAll(async () => {
      owner = await signUpUser(app, "projects-owner");
      intruder = await signUpUser(app, "projects-intruder");
      const created = await createProject(owner, { name: "Owner only" });
      expect(created.statusCode).toBe(201);
      projectId = (created.json() as ProjectBody).id;
    });

    it("another user's project 404s on read AND write (no existence oracle)", async () => {
      const read = await inject(app, {
        method: "GET",
        url: `/v1/projects/${projectId}`,
        headers: { cookie: intruder.cookie },
      });
      expect(read.statusCode).toBe(404);

      const write = await inject(app, {
        method: "PATCH",
        url: `/v1/projects/${projectId}`,
        headers: { cookie: intruder.cookie },
        payload: { name: "hijacked" },
      });
      expect(write.statusCode).toBe(404);

      const remove = await inject(app, {
        method: "DELETE",
        url: `/v1/projects/${projectId}`,
        headers: { cookie: intruder.cookie },
      });
      expect(remove.statusCode).toBe(404);
    });

    it("the other user's list never contains it; the owner's does", async () => {
      const intruderList = await inject(app, {
        method: "GET",
        url: "/v1/projects",
        headers: { cookie: intruder.cookie },
      });
      expect((intruderList.json() as PageBody).items).toEqual([]);

      const ownerList = await inject(app, {
        method: "GET",
        url: "/v1/projects",
        headers: { cookie: owner.cookie },
      });
      expect((ownerList.json() as PageBody).items.map((p) => p.id)).toContain(projectId);

      // And the failed PATCH above really was a no-op.
      const intact = await inject(app, {
        method: "GET",
        url: `/v1/projects/${projectId}`,
        headers: { cookie: owner.cookie },
      });
      expect(intact.json()).toMatchObject({ name: "Owner only" });
    });
  });

  describe("site persistence (step 6.3c)", () => {
    let user: TestUser;
    let projectId: string;

    const site = {
      id: "plot-1",
      terrain: [{ id: "t1", elevation_mm: 0 }],
      placements: [{ instanceId: "gate", pose: { origin_mm: { x: 0, y: 0 } } }],
      connections: [],
    };
    const instances = [
      { instanceId: "gate", releaseId: "sliding-gate@1", input: { width_mm: 4000 } },
    ];

    beforeAll(async () => {
      user = await signUpUser(app, "projects-site");
      const created = await createProject(user, { name: "Site project" });
      projectId = (created.json() as ProjectBody).id;
    });

    const getSite = (cookie: string) =>
      inject(app, { method: "GET", url: `/v1/projects/${projectId}/site`, headers: { cookie } });
    const putSite = (cookie: string, payload: unknown) =>
      inject(app, {
        method: "PUT",
        url: `/v1/projects/${projectId}/site`,
        headers: { cookie },
        payload: payload as Record<string, unknown>,
      });

    it("starts empty: { site: null, instances: [], version: 1 }", async () => {
      const response = await getSite(user.cookie);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ site: null, instances: [], version: 1 });
    });

    it("PUT then GET round-trips the site graph and roster byte-for-byte (version bumps)", async () => {
      const before = (await getSite(user.cookie)).json() as { version: number };
      const saved = await putSite(user.cookie, {
        site,
        instances,
        expectedVersion: before.version,
      });
      expect(saved.statusCode).toBe(200);
      expect(saved.json()).toEqual({ site, instances, version: before.version + 1 });

      const fetched = await getSite(user.cookie);
      expect(fetched.json()).toEqual({ site, instances, version: before.version + 1 });
    });

    it("a second PUT fully replaces the roster (no orphan rows accumulate)", async () => {
      const before = (await getSite(user.cookie)).json() as { version: number };
      const replacement = {
        site,
        instances: [{ instanceId: "fence", releaseId: "fence-run@1", input: { length_mm: 6000 } }],
      };
      await putSite(user.cookie, { ...replacement, expectedVersion: before.version });

      const fetched = await getSite(user.cookie);
      expect((fetched.json() as { instances: unknown[] }).instances).toEqual(replacement.instances);
    });

    it("rejects a stale expectedVersion with 409 — concurrent saves don't clobber (ADR 0054)", async () => {
      const { version } = (await getSite(user.cookie)).json() as { version: number };
      // First save with the loaded version wins and bumps it.
      const ok = await putSite(user.cookie, { site, instances, expectedVersion: version });
      expect(ok.statusCode).toBe(200);
      expect((ok.json() as { version: number }).version).toBe(version + 1);
      // A second save still holding the now-stale version is refused, not applied.
      const stale = await putSite(user.cookie, { site, instances, expectedVersion: version });
      expect(stale.statusCode).toBe(409);
    });

    it("404s for a non-owner on both GET and PUT (no oracle)", async () => {
      const intruder = await signUpUser(app, "projects-site-intruder");
      expect((await getSite(intruder.cookie)).statusCode).toBe(404);
      expect(
        (await putSite(intruder.cookie, { site, instances, expectedVersion: 1 })).statusCode,
      ).toBe(404);
    });

    it("the roster is cascade-deleted with the project (soft delete leaves no read path)", async () => {
      await inject(app, {
        method: "DELETE",
        url: `/v1/projects/${projectId}`,
        headers: { cookie: user.cookie },
      });
      // The project 404s, so its site is unreachable — the roster's lifetime is
      // bound to the project (FK cascade backs the hard-delete path).
      expect((await getSite(user.cookie)).statusCode).toBe(404);
    });
  });

  describe("idempotency replay (real Redis)", () => {
    let user: TestUser;

    beforeAll(async () => {
      user = await signUpUser(app, "projects-idem");
    });

    it("replays a POST with the same Idempotency-Key instead of re-executing", async () => {
      const key = randomUUID();

      const first = await createProject(user, { name: "Once only" }, { "idempotency-key": key });
      expect(first.statusCode).toBe(201);
      expect(first.headers["idempotency-replayed"]).toBeUndefined();
      const firstBody = first.json() as ProjectBody;

      const second = await createProject(user, { name: "Once only" }, { "idempotency-key": key });
      expect(second.statusCode).toBe(201);
      expect(second.headers["idempotency-replayed"]).toBe("true");
      expect(second.json()).toEqual(firstBody);

      // The replay really did NOT run the handler again: still one row.
      const list = await inject(app, {
        method: "GET",
        url: "/v1/projects",
        headers: { cookie: user.cookie },
      });
      expect((list.json() as PageBody).items).toHaveLength(1);
    });

    it("a different key executes normally", async () => {
      const response = await createProject(
        user,
        { name: "Second project" },
        { "idempotency-key": randomUUID() },
      );
      expect(response.statusCode).toBe(201);
      expect(response.headers["idempotency-replayed"]).toBeUndefined();
    });
  });
});
