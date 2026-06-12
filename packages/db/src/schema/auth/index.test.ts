import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { piiColumns } from "../../pii.js";
import * as authSchema from "./index.js";

/** The model names better-auth@1.6.16's Drizzle adapter resolves by export key. */
const expectedModels = [
  "account",
  "invitation",
  "member",
  "organization",
  "session",
  "user",
  "verification",
] as const;

describe("auth schema", () => {
  it("exports every Better Auth model under its expected key", () => {
    for (const model of expectedModels) {
      const table = authSchema[model];
      expect(table, model).toBeDefined();
      expect(getTableName(table)).toBe(model);
    }
  });

  it("keeps the adapter-facing column keys Better Auth expects", () => {
    expect(Object.keys(getTableColumns(authSchema.user))).toEqual(
      expect.arrayContaining(["id", "name", "email", "emailVerified", "image", "role", "banned"]),
    );
    expect(Object.keys(getTableColumns(authSchema.session))).toEqual(
      expect.arrayContaining([
        "token",
        "userId",
        "expiresAt",
        "impersonatedBy",
        "activeOrganizationId",
      ]),
    );
    expect(Object.keys(getTableColumns(authSchema.account))).toEqual(
      expect.arrayContaining(["accountId", "providerId", "userId", "password"]),
    );
  });

  it("registers its personal-data columns in the PII registry", () => {
    expect(piiColumns()).toEqual(
      expect.arrayContaining([
        "invitation.email",
        "session.ip_address",
        "session.user_agent",
        "user.email",
        "user.image",
        "user.name",
        "verification.identifier",
      ]),
    );
  });
});
