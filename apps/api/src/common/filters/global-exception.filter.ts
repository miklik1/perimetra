/**
 * Global exception filter (ADR 0014/0030/1035): every non-2xx response carries
 * the envelope `@repo/validators`' `apiErrorEnvelopeSchema` declares —
 * `{ message, code?, details?, errors? }` — so the frontend `ApiError`
 * taxonomy parses backend errors without translation.
 *
 * Unknown (non-HttpException) errors become an opaque 500: internals are
 * logged with the request id, never serialized to the client.
 *
 * `details` is OPT-IN: only a body built by `errorEnvelope()` publishes it.
 * See that function for why an opt-in marker, and not a shape check, is the
 * rule.
 */
import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from "@nestjs/common";
import * as Sentry from "@sentry/node";
import { type FastifyReply } from "fastify";

import { apiErrorEnvelopeSchema, type ApiErrorEnvelope } from "@repo/validators/api-error";

/**
 * The envelope's TypeScript shape and its runtime guards are both DERIVED from
 * `@repo/validators`' `apiErrorEnvelopeSchema` — never restated.
 *
 * That is the point, not a convenience. A guard that restates a schema drifts
 * from it silently, and this one already had: a hand-written
 * `typeof value === "object" && !Array.isArray(value)` accepted a `Date`, a
 * `Map` and every class instance, all of which serialize to something that is
 * NOT a `Record<string, unknown>` on the wire (a `Date` becomes a JSON string),
 * so the filter published shapes the declared contract forbids. The same class
 * of drift had also reached `errors`, where the old check accepted a nested
 * array the schema rejects. Deriving makes both impossible by construction —
 * the day the schema changes, this file changes with it (ADR 1035, ADR 1031).
 *
 * Reaching the schema from `apps/api` needed two things that did not exist, and
 * both were added rather than worked around: a dist-mapped `./api-error` entry
 * in `packages/validators`' `exports` (the package ROOT maps to extensionless
 * source, which this app's NodeNext resolution rejects — `tsc` fails TS2835 and
 * a value import dies with ERR_MODULE_NOT_FOUND in the COMPILED api at boot,
 * while vitest, which transpiles, stays green: tests are not the gate here),
 * and the matching `no-restricted-imports` allow-list entry (ADR 0011).
 */
type ErrorEnvelope = ApiErrorEnvelope;

/** The declared shape of each envelope field, as the schema itself defines it. */
const envelopeShape = apiErrorEnvelopeSchema.shape;

/**
 * The opt-in marker for the `details` slot.
 *
 * Module-local and therefore UNFORGEABLE: the only way to stamp it is
 * `errorEnvelope()` below, so "this body publishes context" is a fact about the
 * PRODUCER rather than a guess about the shape of a thrown object.
 *
 * That distinction is the whole rule. `details` first forwarded on shape alone
 * — "the thrown body has an object under `details`" — and third-party libraries
 * do not know this envelope exists. `@nestjs/terminus` throws a
 * `ServiceUnavailableException` whose body is `{ status, info, error, details }`
 * where ITS `details` is the readiness map; forwarding on shape published, on
 * the PUBLIC unauthenticated `GET /health/ready`, which internal dependencies
 * exist and which one is failing. Special-casing Terminus would restate one
 * library; requiring the marker derives the rule, and holds for every
 * third-party exception that ever reaches this filter, including the ones that
 * are not written yet.
 *
 * The marker never reaches the wire, twice over: the filter copies fields into
 * a fresh object, and `JSON.stringify` ignores symbol keys.
 */
const ENVELOPE_MARKER = Symbol("repo.error-envelope.opt-in");

/**
 * A thrown body that has opted in to publishing its `details`. Deliberately NOT
 * exported: callers pass the result straight into an `HttpException` and never
 * need to name it, and an exported alias nobody imports is dead surface.
 */
type PublishedErrorBody = ErrorEnvelope & { readonly [ENVELOPE_MARKER]: true };

/**
 * Build the body of a DELIBERATE typed rejection:
 *
 *     throw new ConflictException(
 *       errorEnvelope({
 *         message: "…",
 *         code: "quote_superseded",
 *         details: { supersededById },
 *       }),
 *     );
 *
 * Two things happen here and both are load-bearing:
 *
 * 1. The argument is typed `ErrorEnvelope` — the shape this filter emits, and
 *    the shape `apiErrorEnvelopeSchema` declares — so every throw site is
 *    checked against the contract by the compiler, which is where the ADR 1031
 *    class of defect actually dies. `details: new Date()` (or a `Map`, an
 *    array, or any class instance) does not compile: TypeScript gives an
 *    interface or class no implicit index signature, so none of them is
 *    assignable to `Record<string, unknown>`. Before this, `details` was typed
 *    nowhere and guarded by `typeof value === "object"`, so a `Date` was
 *    accepted and then serialized to a STRING on the wire — the declared shape
 *    and the delivered value disagreed, silently.
 * 2. It stamps the opt-in marker, without which the filter drops `details`.
 *
 * Note `details` must be an object LITERAL or a `type` alias — a value typed by
 * an `interface` has no implicit index signature and will not compile here.
 * That is the contract talking, not a quirk to work around: the wire shape is
 * `Record<string, unknown>`.
 */
export function errorEnvelope(envelope: ErrorEnvelope): PublishedErrorBody {
  return { ...envelope, [ENVELOPE_MARKER]: true };
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();

    const { status, envelope } = this.toEnvelope(exception);

    if (status >= 500) {
      this.logger.error(
        exception instanceof Error ? (exception.stack ?? exception.message) : exception,
      );
      // No-op without SENTRY_DSN (init guards itself); events pass the
      // beforeSend PII scrubber (ADR 0036/0040).
      Sentry.captureException(exception);
    }

    void reply.status(status).send(envelope);
  }

  private toEnvelope(exception: unknown): {
    status: number;
    envelope: ErrorEnvelope;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();

      if (typeof response === "string") {
        return { status, envelope: { message: response } };
      }

      const body = response as Record<string, unknown> & { [ENVELOPE_MARKER]?: unknown };
      const message = Array.isArray(body.message)
        ? body.message.join("; ")
        : typeof body.message === "string"
          ? body.message
          : exception.message;

      return {
        status,
        envelope: {
          message,
          // `code` and `errors` are NOT marker-gated, deliberately. They predate
          // ADR 1035 (ADR 0014/0030) and every producer in every repo drained
          // from this skeleton throws them bare; gating them would silently drop
          // context that ships today — the exact failure mode ADR 1035 exists to
          // fix — to close a far smaller hole. They are also structurally narrow
          // (`string`, and a map of string arrays), so a third-party body has to
          // BE an error envelope to trip them, whereas `details` is
          // `Record<string, unknown>` and accepts anything an object. The
          // residual risk is stated in ADR 1035 rather than hidden here.
          ...(typeof body.code === "string" ? { code: body.code } : {}),
          // ONE SLOT, and only for a producer that asked for it. Two independent
          // conditions, both required:
          //   - the marker: the body came from `errorEnvelope()`, so a human
          //     decided this payload is public (see ENVELOPE_MARKER);
          //   - the guard: the value is still shaped like the contract at
          //     runtime, for bodies that reached a `throw` through a cast.
          // Context thrown anywhere BUT `details` is dropped regardless. A
          // filter that spread arbitrary properties off a thrown body would turn
          // every internal throw into an accidental public field — a leak that
          // arrives by omission, from code that never mentions the wire. Both
          // rules are pinned by the filter test.
          ...(body[ENVELOPE_MARKER] === true && this.isDetails(body.details)
            ? { details: body.details }
            : {}),
          ...(this.isFieldErrors(body.errors) ? { errors: body.errors } : {}),
        },
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      envelope: { message: "Internal server error", code: "internal" },
    };
  }

  /**
   * Asks the SCHEMA whether this value is a legal `details`, rather than
   * describing what a legal `details` looks like. `.unwrap()` strips the
   * `.optional()` — the caller has already established the key is present, and
   * an optional schema would accept `undefined` and put the key on the wire
   * with no value.
   *
   * Nothing here needs to know that the declaration is
   * `record(string, unknown)`. If it becomes something narrower tomorrow, this
   * guard narrows with it and no comment goes stale.
   */
  private isDetails(value: unknown): value is NonNullable<ErrorEnvelope["details"]> {
    return envelopeShape.details.unwrap().safeParse(value).success;
  }

  /** Same derivation, over whatever the schema declares `errors` to be. */
  private isFieldErrors(value: unknown): value is NonNullable<ErrorEnvelope["errors"]> {
    return envelopeShape.errors.unwrap().safeParse(value).success;
  }
}
