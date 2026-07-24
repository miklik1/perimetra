/**
 * Global exception filter (ADR 0014/0030): every non-2xx response carries the
 * envelope `@repo/validators`' `apiErrorEnvelopeSchema` declares —
 * `{ message, code?, details?, errors? }` — so the frontend `ApiError`
 * taxonomy parses backend errors without translation.
 *
 * Unknown (non-HttpException) errors become an opaque 500: internals are
 * logged with the request id, never serialized to the client.
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

interface ErrorEnvelope {
  message: string;
  code?: string;
  details?: Record<string, unknown>;
  errors?: Record<string, string[]>;
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

      const body = response as Record<string, unknown>;
      const message = Array.isArray(body.message)
        ? body.message.join("; ")
        : typeof body.message === "string"
          ? body.message
          : exception.message;

      return {
        status,
        envelope: {
          message,
          ...(typeof body.code === "string" ? { code: body.code } : {}),
          // The envelope's `details` slot — the typed context a code-carrying
          // rejection needs to be ACTIONABLE (which revision superseded this
          // quote, which engine issues invalidated the site). It was declared in
          // `apiErrorEnvelopeSchema` from the start but never forwarded here, so
          // until now every throw's context was silently dropped on the wire:
          // the client saw `{message, code}` and nothing else. A plain object
          // only — an array or scalar would break the declared shape, and a
          // service that puts context anywhere but `details` still loses it (by
          // design: one slot, not an open passthrough of the thrown body).
          ...(this.isDetails(body.details) ? { details: body.details } : {}),
          ...(this.isFieldErrors(body.errors) ? { errors: body.errors } : {}),
        },
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      envelope: { message: "Internal server error", code: "internal" },
    };
  }

  private isDetails(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private isFieldErrors(value: unknown): value is Record<string, string[]> {
    return (
      typeof value === "object" &&
      value !== null &&
      Object.values(value).every((v) => Array.isArray(v) && v.every((s) => typeof s === "string"))
    );
  }
}
