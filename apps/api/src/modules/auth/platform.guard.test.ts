/**
 * PlatformGuard contract (ADR 0062 + ADR 0040 MFA): an operator reaches the
 * cross-tenant vendor surface ONLY with `role==='admin'` AND `twoFactorEnabled`.
 * Pure unit test over `canActivate` — the membership read is stubbed.
 */
import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import { type MembershipService } from "./membership.service.js";
import { PlatformGuard } from "./platform.guard.js";

function ctxFor(userId: string | null): ExecutionContext {
  const request = userId
    ? { sessionContext: { user: { id: userId } } }
    : { sessionContext: undefined };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function guardWith(access: { isOperator: boolean; twoFactorEnabled: boolean }): PlatformGuard {
  const membership = {
    loadPlatformAccess: async () => access,
  } as unknown as MembershipService;
  return new PlatformGuard(membership);
}

/** Run `canActivate` expecting a ForbiddenException; return its response `code`. */
async function forbiddenCode(guard: PlatformGuard, ctx: ExecutionContext): Promise<string> {
  try {
    await guard.canActivate(ctx);
  } catch (error) {
    expect(error).toBeInstanceOf(ForbiddenException);
    return ((error as ForbiddenException).getResponse() as { code: string }).code;
  }
  throw new Error("expected canActivate to throw");
}

describe("PlatformGuard", () => {
  it("allows an operator who has two-factor enabled", async () => {
    const guard = guardWith({ isOperator: true, twoFactorEnabled: true });
    await expect(guard.canActivate(ctxFor("u_1"))).resolves.toBe(true);
  });

  it("403 `forbidden` for a non-operator (role checked before MFA)", async () => {
    const guard = guardWith({ isOperator: false, twoFactorEnabled: true });
    expect(await forbiddenCode(guard, ctxFor("u_1"))).toBe("forbidden");
  });

  it("403 `mfa_required` for an operator without two-factor (ADR 0040)", async () => {
    const guard = guardWith({ isOperator: true, twoFactorEnabled: false });
    expect(await forbiddenCode(guard, ctxFor("u_1"))).toBe("mfa_required");
  });

  it("throws when SessionGuard did not attach a session first", async () => {
    const guard = guardWith({ isOperator: true, twoFactorEnabled: true });
    await expect(guard.canActivate(ctxFor(null))).rejects.toThrow();
  });
});
