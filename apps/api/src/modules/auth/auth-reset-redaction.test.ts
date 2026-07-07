import { describe, expect, it, vi } from "vitest";

import { logPasswordResetRequest } from "./auth.instance.js";

/**
 * Leak guard for the password-reset stub (H6): the delivery stub must record a
 * reset request WITHOUT the subject's email (PII) or the reset url — the url
 * carries the single-use reset token, an account-takeover credential.
 * Redaction is deny-by-omission, so the test feeds the FULL credential-bearing
 * payload and asserts none of it survives in the log line.
 */
/**
 * DRAIN NOTE (fleet): this test guards a STUB. The skeleton ships no real email
 * provider, so `logPasswordResetRequest` is a placeholder delivery path and this
 * test guards its log line. Once a DERIVED repo replaces the stub with a real
 * `EmailService` / provider send (a templated send with no interpolated log line —
 * e.g. anyora-platform `ddfcd90`, which dropped BOTH the helper and this test),
 * this test has nothing left to guard: drop it, and write a FRESH redaction check
 * scoped to whatever the real send path actually logs, if anything.
 */
describe("logPasswordResetRequest (reset-password log redaction)", () => {
  it("logs only the opaque user id — never the email or the reset url/token", () => {
    const logger = { log: vi.fn() };
    // Shape mirrors Better Auth's sendResetPassword payload: a user that
    // carries the email, plus the token-bearing reset url.
    const user = { id: "user_7f3a", email: "victim@example.com", name: "Victim" };
    const url = "https://app.example.com/reset-password?token=SINGLE_USE_RESET_TOKEN_abc123";

    logPasswordResetRequest(logger, user);

    expect(logger.log).toHaveBeenCalledTimes(1);
    const line = logger.log.mock.calls[0]![0] as string;

    // The correlator is present...
    expect(line).toContain("user_7f3a");
    // ...the credentials are not.
    expect(line).not.toContain(user.email);
    expect(line).not.toContain(url);
    expect(line).not.toContain("SINGLE_USE_RESET_TOKEN_abc123");
    expect(line).not.toMatch(/@/); // no email address
    expect(line).not.toMatch(/https?:\/\//); // no reset url
    expect(line).not.toMatch(/token/i); // no token
  });
});
