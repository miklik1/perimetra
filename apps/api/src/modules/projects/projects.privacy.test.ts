import { describe, expect, it, vi } from "vitest";

import { ProjectsPrivacyHandler } from "./projects.privacy.js";

/**
 * Representative regression for the GDPR export column-strip: a privacy
 * handler's `exportUser` must route its raw `select()` rows through the base
 * export mapper, so internal columns (ownerId / organizationId / deletedAt)
 * never reach a user's Art. 20 download. The processor test mocks handlers, so
 * the leak can only be caught at the handler level — here, on the reference
 * handler the generator copies.
 */
function makeDb(rows: unknown[]) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve(rows)) })),
    })),
  };
}

describe("ProjectsPrivacyHandler export", () => {
  it("strips internal columns (ownerId/organizationId/deletedAt), keeps the subject's data", async () => {
    const db = makeDb([
      {
        id: "p1",
        name: "Proj",
        description: "d",
        status: "active",
        ownerId: "u1",
        organizationId: "o1",
        deletedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    ]);
    const handler = new ProjectsPrivacyHandler(db as never);

    const result = (await handler.exportUser("u1")) as {
      projects: Array<Record<string, unknown>>;
    };
    const [row] = result.projects;

    expect(row).not.toHaveProperty("ownerId");
    expect(row).not.toHaveProperty("organizationId");
    expect(row).not.toHaveProperty("deletedAt");
    expect(row).toEqual({
      id: "p1",
      name: "Proj",
      description: "d",
      status: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
  });

  it("still exports a soft-deleted project's DATA — only the deletedAt marker is dropped", async () => {
    // The reference handler exports soft-deleted rows too (they remain the
    // subject's personal data); the mapper strips only the internal column.
    const db = makeDb([
      {
        id: "p2",
        name: "Archived",
        ownerId: "u1",
        organizationId: null,
        deletedAt: "2026-03-01T00:00:00.000Z",
      },
    ]);
    const handler = new ProjectsPrivacyHandler(db as never);

    const result = (await handler.exportUser("u1")) as {
      projects: Array<Record<string, unknown>>;
    };
    const [row] = result.projects;

    expect(row).toMatchObject({ id: "p2", name: "Archived" });
    expect(row).not.toHaveProperty("deletedAt");
    expect(row).not.toHaveProperty("ownerId");
  });
});
