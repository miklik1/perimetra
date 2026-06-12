import { NotFoundException } from "@nestjs/common";
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

const SCOPE = { userId: "user-1", organizationId: null };
const NOW = new Date("2026-06-10T12:00:00.000Z");

function projectRow(overrides: Partial<ProjectRow> = {}): ProjectRow {
  return {
    id: "01890a5d-ac96-774b-bcce-b302099a0001",
    ownerId: SCOPE.userId,
    organizationId: null,
    name: "Skeleton",
    description: null,
    status: "active",
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
