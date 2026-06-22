import { ConflictException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { type ProjectRow } from "@repo/db/schema/projects";

import { ProjectsService } from "./projects.service.js";

// `@Transactional()` resolves a live TransactionHost from a static registry
// at CALL time — neutralize the wrapper so the unit under test is the
// service's orchestration, not the CLS plumbing (covered by live tests).
vi.mock("@nestjs-cls/transactional", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@nestjs-cls/transactional")>()),
  Transactional: () => () => undefined,
}));

const SCOPE = { userId: "user-1", organizationId: "org-1" };
const NOW = new Date("2026-06-10T12:00:00.000Z");

function projectRow(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: "01890a5d-ac96-774b-bcce-b302099a0001",
    ownerId: SCOPE.userId,
    organizationId: SCOPE.organizationId,
    name: "Skeleton",
    description: null,
    status: "active",
    site: null,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  };
}

function makeService() {
  const repo = {
    list: vi.fn(),
    findById: vi.fn(),
    findByIdSystem: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn(),
    loadInstances: vi.fn(),
    updateSite: vi.fn(),
    replaceInstances: vi.fn().mockResolvedValue(undefined),
  };
  const outbox = { emit: vi.fn().mockResolvedValue("event-id") };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new ProjectsService(repo as never, outbox as never, audit as never);
  return { service, repo, outbox, audit };
}

describe("ProjectsService.create", () => {
  it("inserts, emits project.created (IDs only) and records an audit row", async () => {
    const { service, repo, outbox, audit } = makeService();
    const row = projectRow();
    repo.insert.mockResolvedValue(row);

    const result = await service.create(SCOPE, { name: "Skeleton" });

    expect(outbox.emit).toHaveBeenCalledWith({
      aggregateType: "project",
      aggregateId: row.id,
      eventType: "project.created",
      payload: { projectId: row.id }, // IDs ONLY — never names/PII
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: SCOPE.userId,
        action: "project.create",
        entityType: "project",
        entityId: row.id,
      }),
    );
    // Response contract: Dates serialized to ISO strings, internals dropped.
    expect(result.createdAt).toBe("2026-06-10T12:00:00.000Z");
    expect(result).not.toHaveProperty("ownerId");
  });
});

describe("ProjectsService.update", () => {
  it("audits a diff restricted to the fields that changed", async () => {
    const { service, repo, audit } = makeService();
    const before = projectRow();
    repo.findById.mockResolvedValue(before);
    repo.update.mockResolvedValue(projectRow({ name: "Renamed" }));

    await service.update(SCOPE, before.id, { name: "Renamed" });

    expect(repo.update).toHaveBeenCalledWith(SCOPE, before.id, { name: "Renamed" });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "project.update",
        diff: { before: { name: "Skeleton" }, after: { name: "Renamed" } },
      }),
    );
  });

  it("skips the write and the audit row on a no-op patch", async () => {
    const { service, repo, audit } = makeService();
    repo.findById.mockResolvedValue(projectRow());

    const result = await service.update(SCOPE, projectRow().id, { name: "Skeleton" });

    expect(repo.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(result.name).toBe("Skeleton");
  });

  it("404s when the scope owns no such project", async () => {
    const { service, repo } = makeService();
    repo.findById.mockResolvedValue(null);
    await expect(service.update(SCOPE, "missing", { name: "x" })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe("ProjectsService.archive", () => {
  it("flips status, emits project.archived and audits the transition", async () => {
    const { service, repo, outbox, audit } = makeService();
    const before = projectRow();
    repo.findById.mockResolvedValue(before);
    repo.update.mockResolvedValue(projectRow({ status: "archived" }));

    const result = await service.archive(SCOPE, before.id);

    expect(repo.update).toHaveBeenCalledWith(SCOPE, before.id, { status: "archived" });
    expect(outbox.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "project.archived",
        payload: { projectId: before.id },
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "project.archive",
        diff: { before: { status: "active" }, after: { status: "archived" } },
      }),
    );
    expect(result.status).toBe("archived");
  });

  it("is idempotent: an already-archived project emits and audits nothing", async () => {
    const { service, repo, outbox, audit } = makeService();
    repo.findById.mockResolvedValue(projectRow({ status: "archived" }));

    const result = await service.archive(SCOPE, projectRow().id);

    expect(repo.update).not.toHaveBeenCalled();
    expect(outbox.emit).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(result.status).toBe("archived");
  });
});

describe("ProjectsService.softDelete", () => {
  it("audits the deletion", async () => {
    const { service, repo, audit } = makeService();
    repo.softDelete.mockResolvedValue(true);

    await service.softDelete(SCOPE, projectRow().id);

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "project.delete", entityId: projectRow().id }),
    );
  });

  it("404s when nothing was deleted", async () => {
    const { service, repo, audit } = makeService();
    repo.softDelete.mockResolvedValue(false);

    await expect(service.softDelete(SCOPE, "missing")).rejects.toBeInstanceOf(NotFoundException);
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe("ProjectsService reads", () => {
  it("get 404s identically for missing and foreign projects (no oracle)", async () => {
    const { service, repo } = makeService();
    repo.findById.mockResolvedValue(null);
    await expect(service.get(SCOPE, "someone-elses")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("list maps rows to the response contract and passes the cursor through", async () => {
    const { service, repo } = makeService();
    const row = projectRow();
    repo.list.mockResolvedValue({ items: [row], nextCursor: row.id });

    const page = await service.list(SCOPE, { limit: 20, sort: "createdAt:desc" });

    expect(repo.list).toHaveBeenCalledWith(SCOPE, { limit: 20, sort: "createdAt:desc" });
    expect(page.nextCursor).toBe(row.id);
    expect(page.items[0]).toMatchObject({ id: row.id, createdAt: "2026-06-10T12:00:00.000Z" });
  });
});

describe("ProjectsService.getSite", () => {
  it("returns the stored site + mapped roster (null overrides drop out)", async () => {
    const { service, repo } = makeService();
    const site = { id: "s1", terrain: [], placements: [], connections: [] };
    repo.findById.mockResolvedValue(projectRow({ site }));
    repo.loadInstances.mockResolvedValue([
      {
        id: "i1",
        projectId: projectRow().id,
        instanceId: "gate",
        releaseId: "sliding-gate@1",
        input: { width_mm: 4000 },
        overrides: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]);

    const result = await service.getSite(SCOPE, projectRow().id);

    expect(result.site).toEqual(site);
    expect(result.instances).toEqual([
      { instanceId: "gate", releaseId: "sliding-gate@1", input: { width_mm: 4000 } },
    ]);
  });

  it("returns { site: null, instances: [] } for a project with no site yet", async () => {
    const { service, repo } = makeService();
    repo.findById.mockResolvedValue(projectRow());
    repo.loadInstances.mockResolvedValue([]);

    const result = await service.getSite(SCOPE, projectRow().id);

    expect(result).toEqual({ site: null, instances: [], version: 1 });
  });

  it("404s for a project the scope doesn't own (no roster read)", async () => {
    const { service, repo } = makeService();
    repo.findById.mockResolvedValue(null);

    await expect(service.getSite(SCOPE, "foreign")).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.loadInstances).not.toHaveBeenCalled();
  });
});

describe("ProjectsService.saveSite", () => {
  const site = { id: "s1", terrain: [], placements: [], connections: [] };
  const instances = [
    { instanceId: "gate", releaseId: "sliding-gate@1", input: { width_mm: 4000 } },
  ];

  it("writes the site (version-gated), replaces the roster and audits the instance count", async () => {
    const { service, repo, audit } = makeService();
    repo.updateSite.mockResolvedValue(projectRow({ site, version: 2 }));

    const result = await service.saveSite(SCOPE, projectRow().id, {
      site,
      instances,
      expectedVersion: 1,
    });

    expect(repo.updateSite).toHaveBeenCalledWith(SCOPE, projectRow().id, site, 1);
    expect(repo.replaceInstances).toHaveBeenCalledWith(projectRow().id, [
      {
        instanceId: "gate",
        releaseId: "sliding-gate@1",
        input: { width_mm: 4000 },
        overrides: null,
      },
    ]);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "project.site.save",
        diff: { before: null, after: { instanceCount: 1 } },
      }),
    );
    // Returns the bumped version so the client's next save isn't stale.
    expect(result).toEqual({ site, instances, version: 2 });
  });

  it("404s (and never touches the roster) when the scope owns no such project", async () => {
    const { service, repo } = makeService();
    repo.updateSite.mockResolvedValue(null);
    repo.findById.mockResolvedValue(null); // disambiguation: doesn't exist

    await expect(
      service.saveSite(SCOPE, "foreign", { site, instances, expectedVersion: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.replaceInstances).not.toHaveBeenCalled();
  });

  it("409s (and never touches the roster) when a concurrent save bumped the version", async () => {
    const { service, repo } = makeService();
    repo.updateSite.mockResolvedValue(null); // version no longer matches
    repo.findById.mockResolvedValue(projectRow({ version: 2 })); // ...but it exists

    await expect(
      service.saveSite(SCOPE, projectRow().id, { site, instances, expectedVersion: 1 }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.replaceInstances).not.toHaveBeenCalled();
  });
});
