import { describe, expect, it } from "vitest";

import {
  createProjectSchema,
  listProjectsQuerySchema,
  projectSchema,
  updateProjectSchema,
} from "./projects";

const VALID_PROJECT = {
  id: "01890a5d-ac96-774b-bcce-b302099a8057",
  name: "Skeleton",
  description: null,
  status: "active",
  createdAt: "2026-06-10T12:00:00.000Z",
  updatedAt: "2026-06-10T12:00:00.000Z",
};

describe("projectSchema", () => {
  it("accepts the response shape and strips unknown keys", () => {
    const parsed = projectSchema.parse({ ...VALID_PROJECT, ownerId: "leak-me" });
    expect(parsed).toEqual(VALID_PROJECT);
    expect("ownerId" in parsed).toBe(false);
  });

  it("rejects an unknown status", () => {
    expect(projectSchema.safeParse({ ...VALID_PROJECT, status: "paused" }).success).toBe(false);
  });
});

describe("createProjectSchema", () => {
  it("requires a 1-200 char name", () => {
    expect(createProjectSchema.safeParse({ name: "" }).success).toBe(false);
    expect(createProjectSchema.safeParse({ name: "x".repeat(201) }).success).toBe(false);
    expect(createProjectSchema.safeParse({ name: "ok" }).success).toBe(true);
  });

  it("caps description at 2000 chars", () => {
    expect(
      createProjectSchema.safeParse({ name: "ok", description: "d".repeat(2001) }).success,
    ).toBe(false);
  });
});

describe("updateProjectSchema", () => {
  it("accepts a partial patch but keeps field rules", () => {
    expect(updateProjectSchema.safeParse({}).success).toBe(true);
    expect(updateProjectSchema.safeParse({ name: "" }).success).toBe(false);
  });
});

describe("listProjectsQuerySchema", () => {
  it("applies defaults", () => {
    expect(listProjectsQuerySchema.parse({})).toEqual({
      limit: 20,
      sort: "createdAt:desc",
    });
  });

  it("coerces limit from a query string and bounds it 1-100", () => {
    expect(listProjectsQuerySchema.parse({ limit: "50" }).limit).toBe(50);
    expect(listProjectsQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
    expect(listProjectsQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
  });

  it("requires the cursor to be a uuid", () => {
    expect(listProjectsQuerySchema.safeParse({ cursor: "not-a-uuid" }).success).toBe(false);
  });
});
