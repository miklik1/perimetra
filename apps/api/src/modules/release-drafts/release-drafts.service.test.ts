/**
 * Service unit test — the CRUD orchestration: create audits + returns the
 * detail contract, autosave `update` overwrites WITHOUT an audit row (high-
 * frequency working state), reads/delete 404 with no existence oracle.
 */
import { NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { type ReleaseDraftRow } from "@repo/db/schema/release-drafts";

import { ReleaseDraftsService } from "./release-drafts.service.js";

// `@Transactional()` resolves a live TransactionHost from a static registry at
// CALL time — neutralize the wrapper so the unit under test is the service's
// orchestration, not the CLS plumbing (covered by the integration tests).
vi.mock("@nestjs-cls/transactional", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@nestjs-cls/transactional")>()),
  Transactional: () => () => undefined,
}));

const SCOPE = { userId: "user-1", organizationId: "org-1" };
const NOW = new Date("2026-01-01T00:00:00.000Z");

function makeRow(overrides: Partial<ReleaseDraftRow> = {}): ReleaseDraftRow {
  return {
    id: "01890a5d-ac96-774b-bcce-b302099a0001",
    ownerId: SCOPE.userId,
    organizationId: SCOPE.organizationId,
    modelId: "sliding-gate",
    version: 2,
    catalogVersion: 2,
    baseReleaseId: null,
    body: { hello: "world" },
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
    insert: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn(),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new ReleaseDraftsService(repo as never, audit as never);
  return { service, repo, audit };
}

describe("ReleaseDraftsService.create", () => {
  it("inserts, records an audit row, and returns the stripped detail contract", async () => {
    const { service, repo, audit } = makeService();
    repo.insert.mockResolvedValue(makeRow());

    const result = await service.create(SCOPE, {
      modelId: "sliding-gate",
      version: 2,
      catalogVersion: 2,
      baseReleaseId: null,
      body: { hello: "world" },
    });

    expect(repo.insert).toHaveBeenCalledWith(
      SCOPE,
      expect.objectContaining({ modelId: "sliding-gate", version: 2, body: { hello: "world" } }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: SCOPE.userId,
        action: "release-draft.create",
        entityType: "release-draft",
      }),
    );
    expect(result.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(result.body).toEqual({ hello: "world" });
    expect(result).not.toHaveProperty("ownerId");
    expect(result).not.toHaveProperty("organizationId");
  });

  it("defaults a missing body to {} (the NOT NULL jsonb column)", async () => {
    const { service, repo } = makeService();
    repo.insert.mockResolvedValue(makeRow({ body: {} }));

    await service.create(SCOPE, {
      modelId: "",
      version: 1,
      catalogVersion: null,
      baseReleaseId: null,
      body: undefined,
    });

    expect(repo.insert).toHaveBeenCalledWith(SCOPE, expect.objectContaining({ body: {} }));
  });
});

describe("ReleaseDraftsService.update (autosave)", () => {
  it("overwrites the body WITHOUT an audit row (high-frequency working state)", async () => {
    const { service, repo, audit } = makeService();
    repo.update.mockResolvedValue(makeRow({ body: { changed: true } }));

    const result = await service.update(SCOPE, "id", { body: { changed: true } });

    expect(repo.update).toHaveBeenCalledWith(SCOPE, "id", { body: { changed: true } });
    expect(audit.record).not.toHaveBeenCalled();
    expect(result.body).toEqual({ changed: true });
  });

  it("404s when the scope owns no such draft", async () => {
    const { service, repo } = makeService();
    repo.update.mockResolvedValue(null);
    await expect(service.update(SCOPE, "missing", { body: {} })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("an empty patch returns the current row without writing", async () => {
    const { service, repo } = makeService();
    repo.findById.mockResolvedValue(makeRow());

    const result = await service.update(SCOPE, "id", {});

    expect(repo.update).not.toHaveBeenCalled();
    expect(result.id).toBe(makeRow().id);
  });
});

describe("ReleaseDraftsService reads + delete", () => {
  it("get 404s identically for missing and foreign rows (no oracle)", async () => {
    const { service, repo } = makeService();
    repo.findById.mockResolvedValue(null);
    await expect(service.get(SCOPE, "someone-elses")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("softDelete audits the deletion and 404s a missing draft", async () => {
    const { service, repo, audit } = makeService();
    repo.softDelete.mockResolvedValue(true);
    await service.softDelete(SCOPE, "id");
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "release-draft.delete" }),
    );

    repo.softDelete.mockResolvedValue(false);
    await expect(service.softDelete(SCOPE, "missing")).rejects.toBeInstanceOf(NotFoundException);
  });
});
