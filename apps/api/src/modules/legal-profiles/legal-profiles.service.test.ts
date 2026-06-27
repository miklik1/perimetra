/**
 * Legal-profiles service unit test (ADR 0088) — the singleton contract: `get`
 * returns null for a not-yet-completed org (an honest empty state, NOT a 404),
 * and `upsert` audits create-vs-update and serializes through the response
 * contract (Dates → ISO, internals dropped).
 */
import { describe, expect, it, vi } from "vitest";

import { type LegalProfileRow } from "@repo/db/schema/legal-profiles";

import { LegalProfilesService } from "./legal-profiles.service.js";

// `@Transactional()` resolves a live TransactionHost at CALL time — neutralize
// the wrapper so the unit under test is the service's orchestration.
vi.mock("@nestjs-cls/transactional", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@nestjs-cls/transactional")>()),
  Transactional: () => () => undefined,
}));

const SCOPE = { userId: "user-1", organizationId: "org-1" };
const NOW = new Date("2026-01-01T00:00:00.000Z");

function makeRow(overrides: Partial<LegalProfileRow> = {}): LegalProfileRow {
  return {
    id: "01890a5d-ac96-774b-bcce-b302099a0001",
    organizationId: "org-1",
    ownerId: SCOPE.userId,
    name: "Perimetra Vrata s.r.o.",
    ico: "27074358",
    dic: "CZ27074358",
    vatPayer: true,
    addressLine: null,
    city: null,
    postalCode: null,
    country: "CZ",
    bankAccount: null,
    registrationNote: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeService() {
  const repo = { find: vi.fn(), upsert: vi.fn() };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new LegalProfilesService(repo as never, audit as never);
  return { service, repo, audit };
}

describe("LegalProfilesService.get", () => {
  it("returns null for a not-yet-completed org (empty state, not a 404)", async () => {
    const { service, repo } = makeService();
    repo.find.mockResolvedValue(null);
    await expect(service.get(SCOPE)).resolves.toBeNull();
  });

  it("maps the row to the response contract (internals dropped, Dates → ISO)", async () => {
    const { service, repo } = makeService();
    repo.find.mockResolvedValue(makeRow());
    const result = await service.get(SCOPE);
    expect(result?.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(result).not.toHaveProperty("ownerId");
    expect(result).not.toHaveProperty("organizationId");
  });
});

describe("LegalProfilesService.upsert", () => {
  it("audits a CREATE when no profile existed", async () => {
    const { service, repo, audit } = makeService();
    repo.find.mockResolvedValue(null);
    repo.upsert.mockResolvedValue(makeRow());

    await service.upsert(SCOPE, { name: "Perimetra Vrata s.r.o.", vatPayer: true });

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "legal-profile.create", entityType: "legal-profile" }),
    );
  });

  it("audits an UPDATE when a profile already existed", async () => {
    const { service, repo, audit } = makeService();
    repo.find.mockResolvedValue(makeRow({ name: "Old name" }));
    repo.upsert.mockResolvedValue(makeRow({ name: "New name" }));

    const result = await service.upsert(SCOPE, { name: "New name", vatPayer: true });

    expect(result.name).toBe("New name");
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "legal-profile.update" }),
    );
  });
});
