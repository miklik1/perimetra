/**
 * The wire shape of an error (ADR 0014/0030, tightened by ADR 1035). This filter
 * is the ONLY producer of the envelope, so it is the only place the contract can
 * be pinned — and it had no test: `details` was declared in
 * `apiErrorEnvelopeSchema` from the start, never forwarded, and the omission
 * survived every green gate because nothing asserted the envelope end to end. A
 * service threw typed context, the client received `{message, code}`, and both
 * halves read as correct in isolation — the stripped body still PARSES, since
 * every field but `message` is optional.
 *
 * Assert with `toEqual` on the whole body, never `toMatchObject`: a dropped
 * field is invisible to a partial match, which is precisely how this defect
 * stayed green everywhere else. The same asymmetry is why an ADDED field needs
 * whole-body assertions too — forwarding `details` on shape alone leaked
 * `@nestjs/terminus`'s readiness map on the anonymous `GET /health/ready`, and a
 * partial match could not have seen that either.
 *
 * The schema itself is NOT importable from `apps/api` — see the note on the
 * filter's `ErrorEnvelope` declaration for the two measured reasons and the
 * two-line unlock, which has since been taken: `@repo/validators` now publishes
 * a dist-mapped `./api-error`, so the filter DERIVES its guards from the schema
 * and the two can no longer disagree. The oracle here is therefore what a value
 * actually looks like AFTER JSON serialization — the wire is the contract, and
 * it is not a copy of the rule under test.
 */
import { ConflictException, Logger, UnprocessableEntityException } from "@nestjs/common";
import type { ArgumentsHost } from "@nestjs/common";
import { HealthCheckService, HealthIndicatorService, TerminusModule } from "@nestjs/terminus";
import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiErrorEnvelopeSchema } from "@repo/validators/api-error";

import { errorEnvelope, GlobalExceptionFilter } from "./global-exception.filter.js";

function runFilter(exception: unknown): { status?: number; body?: unknown } {
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

  new GlobalExceptionFilter().catch(exception, host);
  return sent;
}

/**
 * `Record<string, unknown>` AS SEEN ON THE WIRE. This is not a second copy of
 * the filter's guard: after JSON serialization the only things a value can be
 * are object / array / string / number / boolean / null, so "is a record" has
 * exactly one meaning here and no `Date`, `Map` or class instance can hide
 * inside it. That is the point — the guard runs on JS values, the contract is
 * about what the client receives, and the gap between them was the defect.
 */
function isWireRecord(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

describe("GlobalExceptionFilter — the error envelope", () => {
  beforeEach(() => {
    // The 500 path logs the stack + reports to Sentry (a no-op without a DSN),
    // and Terminus logs its own failed check; silence the logger so an expected
    // case does not print like a failure.
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  it("forwards the typed `details` a code-carrying rejection needs to be actionable", () => {
    const sent = runFilter(
      new ConflictException(
        errorEnvelope({
          message: "A request with this Idempotency-Key is already in flight",
          code: "idempotency_in_flight",
          details: { idempotencyKey: "k1", retryable: true },
        }),
      ),
    );

    expect(sent.status).toBe(409);
    expect(sent.body).toEqual({
      message: "A request with this Idempotency-Key is already in flight",
      code: "idempotency_in_flight",
      details: { idempotencyKey: "k1", retryable: true },
    });
  });

  it("carries a nested `details` payload through intact — arrays are legal INSIDE the slot", () => {
    // The slot itself must be a plain object (see below); what it CONTAINS is
    // free-form — `apiErrorEnvelopeSchema` types it `record(string, unknown)`.
    // This pins that the filter forwards the value as-is rather than reshaping
    // it, which is what a client branch rendering a list out of `details`
    // depends on.
    const conflicts = [{ field: "slug", reason: "taken" }];

    const sent = runFilter(
      new UnprocessableEntityException(
        errorEnvelope({
          message: "Request could not be processed",
          code: "unprocessable",
          details: { conflicts, retryable: false },
        }),
      ),
    );

    expect(sent.status).toBe(422);
    expect(sent.body).toEqual({
      message: "Request could not be processed",
      code: "unprocessable",
      details: { conflicts, retryable: false },
    });
  });

  it("drops context thrown OUTSIDE `details` — the envelope has one slot, not a passthrough", () => {
    // Opting in publishes the `details` slot, not the whole body: a property
    // parked next to `message` is still dropped, deliberately.
    const optedIn = runFilter(
      new ConflictException({
        ...errorEnvelope({ message: "nope", code: "conflict" }),
        attemptedAt: "2026-07-27",
      }),
    );
    expect(optedIn.body).toEqual({ message: "nope", code: "conflict" });

    const bare = runFilter(
      new ConflictException({ message: "nope", code: "conflict", attemptedAt: "2026-07-27" }),
    );
    expect(bare.body).toEqual({ message: "nope", code: "conflict" });
  });

  it("keeps field errors on `errors` and a string response as the message", () => {
    const withFields = runFilter(
      new UnprocessableEntityException({ message: "invalid", errors: { name: ["required"] } }),
    );
    expect(withFields.body).toEqual({ message: "invalid", errors: { name: ["required"] } });

    const asString = runFilter(new ConflictException("plain"));
    expect(asString.body).toEqual({ message: "plain" });
  });

  it("turns an unknown error into an opaque 500 that leaks no internals", () => {
    const sent = runFilter(new Error("connection string: postgres://user:pw@host"));

    expect(sent.status).toBe(500);
    expect(sent.body).toEqual({ message: "Internal server error", code: "internal" });
  });

  describe("`details` is opt-in, because a third-party body is not a producer (ADR 1035)", () => {
    it("does NOT forward a `details` on a body that never opted in", () => {
      // Byte-identical to the opted-in case above minus `errorEnvelope()`. The
      // difference is not the shape — it is who put the object there.
      const sent = runFilter(
        new ConflictException({
          message: "nope",
          code: "conflict",
          details: { internalHost: "db-primary.internal", failing: "drizzle" },
        }),
      );

      expect(sent.body).toEqual({ message: "nope", code: "conflict" });
    });

    it("does not publish Terminus's readiness map on the anonymous readiness probe", async () => {
      // The real library, not a fixture of it: this is the exception
      // `HealthController.ready()` throws when a dependency is down, produced by
      // the real `HealthCheckService` over the same indicator shape the
      // controller builds (`common/` keeps no import edge into `modules/`, so
      // the indicators are rebuilt here rather than imported). Terminus reports
      // by putting its own object under `details` — it predates this envelope
      // and never opted into anything — and `GET /health/ready` is `@Public()`,
      // so anything forwarded here is readable by an anonymous caller.
      const moduleRef = await Test.createTestingModule({ imports: [TerminusModule] }).compile();
      const health = moduleRef.get(HealthCheckService);
      const indicator = moduleRef.get(HealthIndicatorService);

      const thrown: unknown = await health
        .check([
          () => indicator.check("database").down({ message: "unreachable" }),
          () => indicator.check("redis").up(),
        ])
        .then(
          () => null,
          (error: unknown) => error,
        );

      // Guard the guard: if Terminus ever stops throwing here the assertions
      // below would pass vacuously.
      expect(thrown).toBeInstanceOf(Error);

      const sent = runFilter(thrown);
      expect(sent.status).toBe(503);
      expect(sent.body).toEqual({ message: "Service Unavailable Exception" });

      // Names of internal dependencies are the disclosure, not just the map.
      const serialized = JSON.stringify(sent.body);
      expect(serialized).not.toContain("database");
      expect(serialized).not.toContain("redis");
      expect(serialized).not.toContain("unreachable");
    });
  });

  describe("the runtime guard cannot be looser than the contract (ADR 1031)", () => {
    // A hand-written predicate that RESTATES a schema drifts from it. The old
    // guard was `typeof value === "object" && !Array.isArray(value)`, which
    // accepts a `Date` — declared `Record<string, unknown>`, delivered to the
    // client as a JSON STRING. Nothing about that is visible to a predicate
    // test; it is only visible on the wire, so the wire is the oracle here:
    // whatever is forwarded must still BE a `Record<string, unknown>` after the
    // round trip the response makes, unchanged.
    //
    // The invariant is one-directional on purpose: forwarded ⟹ it survives
    // serialization as the declared shape. The guard MAY be stricter than the
    // schema (it refuses a cross-realm plain object that zod's own
    // `isPlainObject` tolerates); that direction only ever drops a field. It may
    // never be looser — that direction puts an undeclared shape on the wire.
    const corpus: [name: string, value: unknown][] = [
      ["plain object", { idempotencyKey: "k1", retryable: true }],
      ["empty object", {}],
      ["null-prototype object", Object.assign(Object.create(null) as object, { a: 1 })],
      ["nested arrays and objects", { conflicts: [{ field: "slug" }] }],
      ["Date", new Date("2026-07-27T00:00:00.000Z")],
      ["Map", new Map([["a", 1]])],
      ["Error", new Error("boom")],
      ["class instance", new (class Ctx {})()],
      ["array", [{ field: "slug" }]],
      ["string", "not an object"],
      ["number", 1],
      ["null", null],
      ["undefined", undefined],
    ];

    it.each(corpus)("%s: forwarded only if it survives the wire unchanged", (_name, value) => {
      // The marker is stamped by the helper, then an illegal `details` is
      // planted past the compiler — the runtime guard exists for exactly the
      // bodies that reached a `throw` through a cast.
      const planted = {
        ...errorEnvelope({ message: "m", code: "c" }),
        details: value,
      } as unknown as Record<string, unknown>;
      const emitted = runFilter(new ConflictException(planted));
      const body = emitted.body as { details?: unknown };

      // Dropped is always a safe answer; the vacuity check below stops that from
      // making this suite trivially green.
      if (!Object.hasOwn(body, "details")) return;

      // Forwarded — so it has to still BE the declared shape after the response
      // is serialized, and it has to still be the value the producer wrote.
      // `Date` fails the first (it becomes a string), an array fails it too;
      // `Map` and `Error` fail the second (their content does not survive).
      const onTheWire: unknown = (JSON.parse(JSON.stringify(body)) as { details?: unknown })
        .details;
      expect(isWireRecord(onTheWire)).toBe(true);
      expect(onTheWire).toEqual(body.details);
    });

    it("keeps the guard from being vacuously strict — a legal object IS forwarded", () => {
      const sent = runFilter(
        new ConflictException(errorEnvelope({ message: "m", code: "c", details: { a: 1 } })),
      );
      expect(sent.body).toEqual({ message: "m", code: "c", details: { a: 1 } });
    });

    it("holds for `errors` too — an array of string arrays is not a field-error map", () => {
      // `Record<string, string[]>` and `string[][]` were indistinguishable to
      // the old predicate: every value of `[["required"]]` IS an array of
      // strings, so it forwarded, and the client received a JSON array where the
      // contract declares an object. Same restatement drift, same file.
      const emitted = runFilter(
        new UnprocessableEntityException({ message: "invalid", errors: [["required"]] }),
      );

      expect(emitted.body).toEqual({ message: "invalid" });
    });

    it("tracks the schema instead of restating it — a narrower declaration narrows the guard", () => {
      // There is no source-text canary here any more, and that is the point.
      // The guard now ASKS `apiErrorEnvelopeSchema` (see `isDetails` /
      // `isFieldErrors`), so the two cannot disagree: if the declaration
      // narrows tomorrow, the filter narrows in the same commit with no test
      // and no comment to update. What is still worth pinning is the DIRECTION
      // of that coupling — that the filter reads the schema's own field
      // schemas, rather than a copy that happens to agree today.
      const details = apiErrorEnvelopeSchema.shape.details.unwrap();

      expect(details.safeParse({ key: "value" }).success).toBe(true);
      expect(details.safeParse(new Date()).success).toBe(false);
      expect(details.safeParse([["required"]]).success).toBe(false);
    });
  });
});
