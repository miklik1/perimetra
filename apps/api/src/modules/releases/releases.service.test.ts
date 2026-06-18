/**
 * Releases service — the immutable-store publish gate (ADR 0053): the envelope
 * guard, the validateRelease defect path (422), the missing-catalog path, the
 * immutability conflict (409), and the audit row. The happy-path golden
 * derivation through real persistence is the integration gate
 * (test/releases.itest.ts).
 */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { type Catalog, type ProductModelRelease } from "@repo/model";

import { ReleasesService } from "./releases.service.js";

// `@Transactional()` resolves a live TransactionHost at call time — neutralize
// the wrapper so the unit under test is the service orchestration.
vi.mock("@nestjs-cls/transactional", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@nestjs-cls/transactional")>()),
  Transactional: () => () => undefined,
}));

const SCOPE = { userId: "admin-1", organizationId: "org-1" };
const EMPTY_CATALOG: Catalog = {
  id: "catalog@1",
  version: 1,
  materials: [],
  sections: [],
  components: [],
};

/** A structurally-valid release that passes validateRelease against any catalog
 *  (no parts → no role resolution). */
function validBody(overrides: Partial<ProductModelRelease> = {}): ProductModelRelease {
  return {
    id: "test-model@1",
    modelId: "test-model",
    version: 1,
    status: "draft",
    parameters: [{ key: "w", type: "length_mm", adjustability: "user", default: 1000 }],
    constraints: [],
    derivation: { derived: [], parts: [] },
    ...overrides,
  };
}

function makeService() {
  const repo = {
    list: vi.fn(),
    findById: vi.fn(),
    findByReleaseId: vi.fn().mockResolvedValue(null),
    insert: vi.fn(),
    // Assignment / pin surface (ADR 0062/0064) — safe defaults; the broadcast
    // suite overrides them. `assign` returns whether a NEW row was inserted.
    assign: vi.fn().mockResolvedValue(true),
    ensurePin: vi.fn().mockResolvedValue(false),
    movePin: vi.fn().mockResolvedValue(undefined),
    findOrgsBehindOnModel: vi.fn().mockResolvedValue([]),
    findPins: vi.fn().mockResolvedValue([]),
  };
  const catalogVersions = { loadCatalog: vi.fn().mockResolvedValue(EMPTY_CATALOG) };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new ReleasesService(repo as never, catalogVersions as never, audit as never);
  return { service, repo, catalogVersions, audit };
}

/** A published release row (the shape `findByReleaseId` returns). */
function publishedRow(
  overrides: Partial<{ releaseId: string; modelId: string; version: number }> = {},
) {
  return {
    id: "row-1",
    releaseId: "gate@2",
    modelId: "gate",
    version: 2,
    catalogVersion: 1,
    status: "published" as const,
    body: validBody(),
    initialInput: null,
    createdAt: new Date("2026-06-18T00:00:00.000Z"),
    updatedAt: new Date("2026-06-18T00:00:00.000Z"),
    ...overrides,
  };
}

describe("ReleasesService.publish", () => {
  it("validates, freezes status=published, inserts and audits", async () => {
    const { service, repo, audit } = makeService();
    const now = new Date("2026-06-13T00:00:00.000Z");
    repo.insert.mockImplementation(async (data) => ({
      id: "01890a5d-ac96-774b-bcce-b302099a0001",
      ...data,
      createdAt: now,
      updatedAt: now,
    }));

    const result = await service.publish(SCOPE, { catalogVersion: 1, body: validBody() });

    expect(repo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        releaseId: "test-model@1",
        modelId: "test-model",
        version: 1,
        catalogVersion: 1,
        status: "published",
      }),
    );
    // The stored body is frozen as published regardless of the submitted status.
    expect((repo.insert.mock.calls[0]![0] as { body: ProductModelRelease }).body.status).toBe(
      "published",
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "release.publish", entityType: "release" }),
    );
    expect(result.status).toBe("published");
    expect(result.releaseId).toBe("test-model@1");
  });

  it("rejects a malformed body with 400 (envelope guard) before the deep gate", async () => {
    const { service, catalogVersions } = makeService();
    await expect(service.publish(SCOPE, { catalogVersion: 1, body: {} })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    // Never even resolved the catalog — the envelope guard short-circuits.
    expect(catalogVersions.loadCatalog).not.toHaveBeenCalled();
  });

  it("rejects when the named catalog version is not published (400)", async () => {
    const { service, catalogVersions } = makeService();
    catalogVersions.loadCatalog.mockResolvedValue(null);
    await expect(
      service.publish(SCOPE, { catalogVersion: 99, body: validBody() }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("surfaces validateRelease defects as 422 (the publish gate, I2)", async () => {
    const { service, repo } = makeService();
    // Duplicate parameter key — a clean validateRelease defect (no ExprString needed).
    const broken = validBody({
      parameters: [
        { key: "w", type: "length_mm", adjustability: "user", default: 1000 },
        { key: "w", type: "length_mm", adjustability: "user", default: 2000 },
      ],
    });
    await expect(
      service.publish(SCOPE, { catalogVersion: 1, body: broken }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it("gates a valid initialInput through and stores it", async () => {
    const { service, repo } = makeService();
    const now = new Date("2026-06-13T00:00:00.000Z");
    repo.insert.mockImplementation(async (data) => ({
      id: "01890a5d-ac96-774b-bcce-b302099a0002",
      ...data,
      createdAt: now,
      updatedAt: now,
    }));

    const result = await service.publish(SCOPE, {
      catalogVersion: 1,
      body: validBody(),
      initialInput: { w: 1500 },
    });

    expect(repo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ initialInput: { w: 1500 } }),
    );
    expect(result.initialInput).toEqual({ w: 1500 });
  });

  it("rejects a broken initialInput with 422 (the I7 input gate)", async () => {
    const { service, repo } = makeService();
    // `zzz` names no parameter — gateInput flags an unknown input key.
    await expect(
      service.publish(SCOPE, { catalogVersion: 1, body: validBody(), initialInput: { zzz: 1 } }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it("refuses to re-publish an existing release (409 — immutable, I3)", async () => {
    const { service, repo } = makeService();
    repo.findByReleaseId.mockResolvedValue({ id: "existing" });
    await expect(
      service.publish(SCOPE, { catalogVersion: 1, body: validBody() }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.insert).not.toHaveBeenCalled();
  });
});

describe("ReleasesService.broadcastAssign", () => {
  it("fans the new version out to every org behind, NEVER moving a pin", async () => {
    const { service, repo } = makeService();
    repo.findByReleaseId.mockResolvedValue(publishedRow()); // gate@2, published
    repo.findOrgsBehindOnModel.mockResolvedValue(["org-a", "org-b"]);
    // org-a is a fresh assign (inserted=true); org-b already had it (false).
    repo.assign.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const result = await service.broadcastAssign("vendor-1", "gate@2");

    // Targets resolved by model + version (orgs on an OLDER version of "gate").
    expect(repo.findOrgsBehindOnModel).toHaveBeenCalledWith("gate", 2);
    // Each org went through the SAME assign path → ensurePin (lazy first-pin),
    // never movePin: the broadcast must not silently change a tenant's active
    // version (§3 — upgrades are explicit opt-in). This is the load-bearing
    // invariant of the whole feature.
    expect(repo.assign).toHaveBeenCalledTimes(2);
    expect(repo.ensurePin).toHaveBeenCalledTimes(2);
    expect(repo.movePin).not.toHaveBeenCalled();
    // The immutable release is validated ONCE up front and the row reused for
    // every org — NOT re-fetched per org (would be an N+1 on an append-only row).
    expect(repo.findByReleaseId).toHaveBeenCalledTimes(1);
    // Assigned vs already-assigned reported off the real-insert flag.
    expect(result).toEqual({
      releaseId: "gate@2",
      assignedOrgIds: ["org-a"],
      skippedOrgIds: ["org-b"],
    });
  });

  it("fails HARD (404) on an unknown release — before reading any target org", async () => {
    const { service, repo } = makeService();
    repo.findByReleaseId.mockResolvedValue(null);
    await expect(service.broadcastAssign("vendor-1", "ghost@9")).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repo.findOrgsBehindOnModel).not.toHaveBeenCalled();
    expect(repo.assign).not.toHaveBeenCalled();
  });

  it("fails HARD (409) on an unpublished release — nothing is assigned", async () => {
    const { service, repo } = makeService();
    repo.findByReleaseId.mockResolvedValue({ ...publishedRow(), status: "draft" });
    await expect(service.broadcastAssign("vendor-1", "gate@2")).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(repo.findOrgsBehindOnModel).not.toHaveBeenCalled();
    expect(repo.assign).not.toHaveBeenCalled();
  });

  it("is a clean no-op when no org is behind", async () => {
    const { service, repo } = makeService();
    repo.findByReleaseId.mockResolvedValue(publishedRow());
    repo.findOrgsBehindOnModel.mockResolvedValue([]);
    const result = await service.broadcastAssign("vendor-1", "gate@2");
    expect(repo.assign).not.toHaveBeenCalled();
    expect(result).toEqual({ releaseId: "gate@2", assignedOrgIds: [], skippedOrgIds: [] });
  });
});
