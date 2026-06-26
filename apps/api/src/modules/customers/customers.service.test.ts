/**
 * Customers service unit test (ADR 0082) — the per-rep scope decision, the
 * field-mapping create/audit contract, the no-oracle 404, and that DELETE
 * anonymizes (never hard-deletes). Rep isolation end-to-end is the integration test.
 */
import { NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { type CustomerRow } from "@repo/db/schema/customers";

import { CustomersService } from "./customers.service.js";

vi.mock("@nestjs-cls/transactional", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@nestjs-cls/transactional")>()),
  Transactional: () => () => undefined,
}));

const SCOPE = { userId: "user-1", organizationId: "org-1" };
const NOW = new Date("2026-01-01T00:00:00.000Z");

function makeRow(overrides: Partial<CustomerRow> = {}): CustomerRow {
  return {
    id: "01890a5d-ac96-774b-bcce-b302099a0001",
    ownerId: SCOPE.userId,
    organizationId: "org-1",
    name: "Stavby s.r.o.",
    ico: null,
    dic: "CZ12345678",
    vatPayer: true,
    email: null,
    phone: null,
    addressLine: null,
    city: null,
    postalCode: null,
    country: "CZ",
    note: null,
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
    insert: vi.fn(),
    update: vi.fn(),
    anonymize: vi.fn(),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new CustomersService(repo as never, audit as never);
  return { service, repo, audit };
}

describe("CustomersService per-rep scope", () => {
  it("admin is NOT owner-restricted; a sales rep IS", async () => {
    const { service, repo } = makeService();
    repo.list.mockResolvedValue({ items: [], nextCursor: null });

    await service.list(SCOPE, "admin", { limit: 20, sort: "createdAt:desc" });
    expect(repo.list).toHaveBeenCalledWith(SCOPE, { restrictToOwner: false }, expect.anything());

    await service.list(SCOPE, "sales", { limit: 20, sort: "createdAt:desc" });
    expect(repo.list).toHaveBeenLastCalledWith(SCOPE, { restrictToOwner: true }, expect.anything());
  });
});

describe("CustomersService.create", () => {
  it("maps fields, audits, and the response drops internals", async () => {
    const { service, repo, audit } = makeService();
    repo.insert.mockResolvedValue(makeRow());
    const result = await service.create(SCOPE, { name: "Stavby s.r.o.", dic: "CZ12345678" });

    expect(repo.insert).toHaveBeenCalledWith(
      SCOPE,
      expect.objectContaining({ name: "Stavby s.r.o.", dic: "CZ12345678", vatPayer: false }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "customer.create", entityType: "customer" }),
    );
    expect(result.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(result).not.toHaveProperty("ownerId");
  });
});

describe("CustomersService reads + erase", () => {
  it("get 404s identically for missing and foreign rows (no oracle)", async () => {
    const { service, repo } = makeService();
    repo.findById.mockResolvedValue(null);
    await expect(service.get(SCOPE, "sales", "someone-elses")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("erase anonymizes (never hard-deletes) and audits", async () => {
    const { service, repo, audit } = makeService();
    repo.anonymize.mockResolvedValue(true);
    await service.erase(SCOPE, "admin", makeRow().id);
    expect(repo.anonymize).toHaveBeenCalledWith(SCOPE, { restrictToOwner: false }, makeRow().id);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "customer.erase" }),
    );
  });

  it("erase 404s when no scoped live row was anonymized", async () => {
    const { service, repo } = makeService();
    repo.anonymize.mockResolvedValue(false);
    await expect(service.erase(SCOPE, "sales", "nope")).rejects.toBeInstanceOf(NotFoundException);
  });
});
