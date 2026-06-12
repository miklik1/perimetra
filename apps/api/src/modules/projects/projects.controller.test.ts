/**
 * DTO validation shape + delegation. Full request-cycle behavior (pipe,
 * serializer interceptor, guard) belongs to e2e/live tests — here we pin the
 * zod contracts the DTOs carry, which is what the ZodValidationPipe enforces.
 */
import { describe, expect, it, vi } from "vitest";

import { ProjectsController } from "./projects.controller.js";
import {
  CreateProjectDto,
  ListProjectsQueryDto,
  ProjectDto,
  UpdateProjectDto,
} from "./projects.dto.js";

const SCOPE = { userId: "user-1", organizationId: null };

describe("project DTO validation shape", () => {
  it("CreateProjectDto enforces the name contract (1-200)", () => {
    expect(CreateProjectDto.schema.safeParse({ name: "" }).success).toBe(false);
    expect(CreateProjectDto.schema.safeParse({ name: "x".repeat(201) }).success).toBe(false);
    expect(CreateProjectDto.schema.safeParse({ name: "ok" }).success).toBe(true);
  });

  it("UpdateProjectDto is a partial of the create contract", () => {
    expect(UpdateProjectDto.schema.safeParse({}).success).toBe(true);
    expect(UpdateProjectDto.schema.safeParse({ description: "d".repeat(2001) }).success).toBe(
      false,
    );
  });

  it("ListProjectsQueryDto coerces and defaults query params", () => {
    expect(ListProjectsQueryDto.schema.parse({ limit: "5" })).toEqual({
      limit: 5,
      sort: "createdAt:desc",
    });
    expect(ListProjectsQueryDto.schema.safeParse({ cursor: "nope" }).success).toBe(false);
  });

  it("ProjectDto strips non-contract fields (the serialization leak gate)", () => {
    const parsed = ProjectDto.schema.parse({
      id: "01890a5d-ac96-774b-bcce-b302099a0001",
      name: "Skeleton",
      description: null,
      status: "active",
      createdAt: "2026-06-10T12:00:00.000Z",
      updatedAt: "2026-06-10T12:00:00.000Z",
      ownerId: "should-be-stripped",
    });
    expect(parsed).not.toHaveProperty("ownerId");
  });
});

describe("ProjectsController delegation", () => {
  it("hands the resolved scope and validated input to the service", async () => {
    const service = {
      list: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      create: vi.fn().mockResolvedValue({}),
      get: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      archive: vi.fn().mockResolvedValue({}),
      softDelete: vi.fn().mockResolvedValue(undefined),
    };
    const controller = new ProjectsController(service as never);
    const id = "01890a5d-ac96-774b-bcce-b302099a0001";
    const query = ListProjectsQueryDto.schema.parse({});

    await controller.list(SCOPE, query as ListProjectsQueryDto);
    await controller.create(SCOPE, { name: "Skeleton" });
    await controller.get(SCOPE, id);
    await controller.update(SCOPE, id, { name: "Renamed" });
    await controller.archive(SCOPE, id);
    await controller.remove(SCOPE, id);

    expect(service.list).toHaveBeenCalledWith(SCOPE, query);
    expect(service.create).toHaveBeenCalledWith(SCOPE, { name: "Skeleton" });
    expect(service.get).toHaveBeenCalledWith(SCOPE, id);
    expect(service.update).toHaveBeenCalledWith(SCOPE, id, { name: "Renamed" });
    expect(service.archive).toHaveBeenCalledWith(SCOPE, id);
    expect(service.softDelete).toHaveBeenCalledWith(SCOPE, id);
  });
});
