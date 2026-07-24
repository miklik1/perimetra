/**
 * The wire shape of an error (ADR 0014/0030, tightened by ADR 0126). This filter
 * is the ONLY thing that decides what a rejection looks like to the frontend, and
 * it had no test: `details` was declared in `apiErrorEnvelopeSchema` from the
 * start, never forwarded, and the omission survived every green gate because
 * nothing asserted the envelope end to end — a service threw typed context, the
 * client received `{message, code}`, and both halves looked correct in isolation.
 * These cases pin the contract in the one place it is actually produced.
 */
import {
  ConflictException,
  Logger,
  UnprocessableEntityException,
  type ArgumentsHost,
} from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GlobalExceptionFilter } from "./global-exception.filter.js";

function replySpy() {
  const sent: { status?: number; body?: unknown } = {};
  const reply = {
    status(code: number) {
      sent.status = code;
      return this;
    },
    send(body: unknown) {
      sent.body = body;
    },
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => reply }),
  } as unknown as ArgumentsHost;
  return { sent, host };
}

describe("GlobalExceptionFilter — the error envelope", () => {
  beforeEach(() => {
    // The 500 path logs the stack + reports to Sentry (a no-op without a DSN);
    // silence the logger so an expected case does not print like a failure.
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  it("forwards the typed `details` a code-carrying rejection needs to be actionable", () => {
    const { sent, host } = replySpy();

    new GlobalExceptionFilter().catch(
      new ConflictException({
        message: "quote has been superseded by a newer revision",
        code: "quote_superseded",
        details: { supersededById: "0199-quote-id" },
      }),
      host,
    );

    expect(sent.status).toBe(409);
    expect(sent.body).toEqual({
      message: "quote has been superseded by a newer revision",
      code: "quote_superseded",
      details: { supersededById: "0199-quote-id" },
    });
  });

  it("carries the I5 issues of a site_invalid rejection through `details`", () => {
    const { sent, host } = replySpy();
    const issues = [
      { key: "engine.site.port_incompatible", severity: "error", scope: "connection" },
    ];

    new GlobalExceptionFilter().catch(
      new UnprocessableEntityException({
        message: "site did not derive to a valid result",
        code: "site_invalid",
        details: { issues },
      }),
      host,
    );

    expect(sent.body).toMatchObject({ code: "site_invalid", details: { issues } });
  });

  it("drops context thrown OUTSIDE `details` — the envelope has one slot, not a passthrough", () => {
    const { sent, host } = replySpy();

    new GlobalExceptionFilter().catch(
      new ConflictException({ message: "nope", code: "quote_not_accepted", status: "expired" }),
      host,
    );

    expect(sent.body).toEqual({ message: "nope", code: "quote_not_accepted" });
  });

  it("rejects a non-object `details` rather than breaking the declared shape", () => {
    const { sent, host } = replySpy();

    new GlobalExceptionFilter().catch(
      new ConflictException({ message: "nope", code: "x", details: ["not", "an", "object"] }),
      host,
    );

    expect(sent.body).toEqual({ message: "nope", code: "x" });
  });

  it("keeps field errors on `errors` and a string response as the message", () => {
    const withFields = replySpy();
    new GlobalExceptionFilter().catch(
      new UnprocessableEntityException({ message: "invalid", errors: { name: ["required"] } }),
      withFields.host,
    );
    expect(withFields.sent.body).toEqual({ message: "invalid", errors: { name: ["required"] } });

    const asString = replySpy();
    new GlobalExceptionFilter().catch(new ConflictException("plain"), asString.host);
    expect(asString.sent.body).toEqual({ message: "plain" });
  });

  it("turns an unknown error into an opaque 500 that leaks no internals", () => {
    const { sent, host } = replySpy();

    new GlobalExceptionFilter().catch(
      new Error("connection string: postgres://user:pw@host"),
      host,
    );

    expect(sent.status).toBe(500);
    expect(sent.body).toEqual({ message: "Internal server error", code: "internal" });
  });
});
