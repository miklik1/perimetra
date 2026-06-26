/**
 * Price-tables service — the immutable-version conflict (409) and the
 * no-active-table miss (404, I5: never a silent empty price layer). The
 * effective-date resolution + golden derivation through real persistence are
 * the integration gate (test/price-tables.itest.ts).
 */
import { ConflictException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { type PriceTableData } from "@repo/validators/price-tables";

import { PriceTablesService } from "./price-tables.service.js";

vi.mock("@nestjs-cls/transactional", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@nestjs-cls/transactional")>()),
  Transactional: () => () => undefined,
}));

const SCOPE = { userId: "tenant-1", organizationId: "org-1" };
const TABLE: PriceTableData = {
  version: 7,
  components: { post: 100 },
  manufacturing: { rate: 790, multiplier: 16 },
  installation: 0,
};

function makeService() {
  const repo = {
    list: vi.fn(),
    findById: vi.fn(),
    findByVersion: vi.fn().mockResolvedValue(null),
    resolveActive: vi.fn(),
    insert: vi.fn(),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new PriceTablesService(repo as never, audit as never);
  return { service, repo, audit };
}

const input = {
  currency: "CZK" as const,
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  dphRate: "21",
  table: TABLE,
};

describe("PriceTablesService.publish", () => {
  it("inserts the version from the table body and audits", async () => {
    const { service, repo, audit } = makeService();
    const now = new Date("2026-06-13T00:00:00.000Z");
    repo.insert.mockResolvedValue({
      id: "row-1",
      version: 7,
      currency: "CZK",
      effectiveFrom: new Date(input.effectiveFrom),
      effectiveTo: null,
      marginFloorPct: null,
      dphRate: "21",
      roundingPolicy: null, // exercises the provisional-default fallback in toDetail
      table: TABLE,
      createdAt: now,
      updatedAt: now,
    });

    const result = await service.publish(SCOPE, input);

    expect(repo.insert).toHaveBeenCalledWith(
      SCOPE,
      expect.objectContaining({
        version: 7,
        currency: "CZK",
        // Provisional default frozen at publish when unset (ADR 0081).
        roundingPolicy: { scale: 2, mode: "half-up", granularity: "end-of-invoice" },
      }),
    );
    expect(result.roundingPolicy).toEqual({
      scale: 2,
      mode: "half-up",
      granularity: "end-of-invoice",
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "price-table.publish" }),
    );
    expect(result.version).toBe(7);
    expect(result.table).toEqual(TABLE);
  });

  it("refuses to re-publish an existing version (409 — immutable, I3)", async () => {
    const { service, repo } = makeService();
    repo.findByVersion.mockResolvedValue({ id: "existing" });
    await expect(service.publish(SCOPE, input)).rejects.toBeInstanceOf(ConflictException);
    expect(repo.insert).not.toHaveBeenCalled();
  });
});

describe("PriceTablesService.resolveActive", () => {
  it("404s when no table covers the instant (no silent empty price layer, I5)", async () => {
    const { service, repo } = makeService();
    repo.resolveActive.mockResolvedValue(null);
    await expect(service.resolveActive(SCOPE, new Date("2025-01-01"))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
