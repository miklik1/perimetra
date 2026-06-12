/**
 * OpenAPI contract snapshot (ADR 0039). Boots the real AppModule on a Fastify
 * adapter exactly like `app.boot.test.ts` — no database needed (pg pools are
 * lazy, nothing here touches a dependency) — builds the generated document and
 * pins it to a committed file snapshot. Any contract drift (new route, changed
 * DTO field, different status code) shows up as a readable JSON diff and fails
 * CI until the snapshot is intentionally regenerated (`vitest run -u`).
 */
import { VersioningType } from "@nestjs/common";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AppModule } from "../app.module.js";
import { loadEnv } from "../common/config/env.js";
import { buildOpenApiDocument, registerOpenApiRoute } from "./document.js";

describe("openapi contract", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    // Mirror main.ts — the doc paths include the URI version prefix (/v1/...).
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("matches the committed contract snapshot", async () => {
    const document = buildOpenApiDocument(app);

    await expect(`${JSON.stringify(document, null, 2)}\n`).toMatchFileSnapshot(
      "./__snapshots__/openapi.json",
    );
  });

  it("serves /openapi.json outside production", async () => {
    // Vitest runs with NODE_ENV=test → the route registers (prod returns early).
    registerOpenApiRoute(app, loadEnv());

    const response = await app
      .getHttpAdapter()
      .getInstance()
      .inject({ method: "GET", url: "/openapi.json" });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { openapi: string; paths: Record<string, unknown> };
    expect(body.openapi).toMatch(/^3\./);
    expect(Object.keys(body.paths)).toContain("/v1/projects");
  });
});
