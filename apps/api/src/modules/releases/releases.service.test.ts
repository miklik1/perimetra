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
  };
  const catalogVersions = { loadCatalog: vi.fn().mockResolvedValue(EMPTY_CATALOG) };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new ReleasesService(repo as never, catalogVersions as never, audit as never);
  return { service, repo, catalogVersions, audit };
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
