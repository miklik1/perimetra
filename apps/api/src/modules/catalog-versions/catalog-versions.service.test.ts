/**
 * Catalog-versions service — the immutable-store publish gate (ADR 0053): the
 * structural shape guard, the immutability conflict (409), and the audit row.
 */
import { BadRequestException, ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { type Catalog } from "@repo/model";

import { CatalogVersionsService } from "./catalog-versions.service.js";

vi.mock("@nestjs-cls/transactional", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@nestjs-cls/transactional")>()),
  Transactional: () => () => undefined,
}));

const SCOPE = { userId: "admin-1", organizationId: "org-1" };
const CATALOG: Catalog = {
  id: "catalog@5",
  version: 5,
  materials: [],
  sections: [],
  components: [],
};

function makeService() {
  const repo = {
    list: vi.fn(),
    findById: vi.fn(),
    findByVersion: vi.fn().mockResolvedValue(null),
    insert: vi.fn(),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new CatalogVersionsService(repo as never, audit as never);
  return { service, repo, audit };
}

describe("CatalogVersionsService.publish", () => {
  it("inserts the version from the body and audits", async () => {
    const { service, repo, audit } = makeService();
    const now = new Date("2026-06-13T00:00:00.000Z");
    repo.insert.mockResolvedValue({
      id: "row-1",
      version: 5,
      body: CATALOG,
      createdAt: now,
      updatedAt: now,
    });

    const result = await service.publish(SCOPE, { body: CATALOG });

    expect(repo.insert).toHaveBeenCalledWith({ version: 5, body: CATALOG });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "catalog-version.publish" }),
    );
    expect(result.version).toBe(5);
  });

  it("rejects a malformed catalog body with 400", async () => {
    const { service } = makeService();
    await expect(service.publish(SCOPE, { body: { version: "five" } })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("refuses to re-publish an existing version (409 — immutable, I3)", async () => {
    const { service, repo } = makeService();
    repo.findByVersion.mockResolvedValue({ id: "existing" });
    await expect(service.publish(SCOPE, { body: CATALOG })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(repo.insert).not.toHaveBeenCalled();
  });
});

describe("CatalogVersionsService.loadCatalog", () => {
  it("returns the typed catalog body for a version, or null", async () => {
    const { service, repo } = makeService();
    repo.findByVersion.mockResolvedValueOnce({ id: "row-1", version: 5, body: CATALOG });
    expect(await service.loadCatalog(5)).toEqual(CATALOG);

    repo.findByVersion.mockResolvedValueOnce(null);
    expect(await service.loadCatalog(404)).toBeNull();
  });
});
