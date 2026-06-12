import { parseRetryAfter, type ApiMiddleware } from "../client/create-api-client";
import { isRetryableStatus } from "../errors";

export interface RetryOptions {
  /** Max retry attempts after the initial try. Default `2`. */
  retries?: number;
  /** Base backoff in ms; the exponential ceiling is `base * 2^attempt`. Default `250`. */
  baseDelayMs?: number;
  /** Upper bound on a single backoff wait. Default `30_000`. */
  maxDelayMs?: number;
}

function isAbort(cause: unknown): boolean {
  return cause instanceof Error && cause.name === "AbortError";
}

/** Full-jitter exponential backoff: a random wait in `[0, min(cap, base*2^n)]`. */
function backoff(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  return Math.random() * ceiling;
}

/** A cancellable delay — rejects if the request's signal aborts mid-wait. */
function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    // Portable AbortError (no DOMException / signal.reason — absent in RN's lib).
    const abortError = () =>
      Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(abortError());
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Transport-level retry policy as injectable middleware (ADR 0012). Retries only
 * idempotent requests (`GET`/`HEAD`) on transport failures, `5xx`, and `429`;
 * mutations and other `4xx` are never replayed. Honors a `Retry-After` header
 * when present, otherwise applies full-jitter exponential backoff, and bails out
 * immediately if the caller's `AbortSignal` fires (TanStack cancellation,
 * unmount/navigation). Compose it ahead of the auth refresh middleware so a
 * refreshed request is itself retryable.
 */
export function createRetryMiddleware(options: RetryOptions = {}): ApiMiddleware {
  const retries = options.retries ?? 2;
  const baseDelayMs = options.baseDelayMs ?? 250;
  const maxDelayMs = options.maxDelayMs ?? 30_000;

  return async (req, next) => {
    const method = (req.init.method ?? "GET").toUpperCase();
    const idempotent = method === "GET" || method === "HEAD";

    let attempt = 0;
    for (;;) {
      try {
        const response = await next(req);
        if (idempotent && attempt < retries && isRetryableStatus(response.status)) {
          const wait =
            parseRetryAfter(response.headers.get("Retry-After")) ??
            backoff(attempt, baseDelayMs, maxDelayMs);
          void response.body?.cancel(); // drop the unread body before retrying
          attempt += 1;
          await sleep(wait, req.init.signal);
          continue;
        }
        return response;
      } catch (cause) {
        if (idempotent && attempt < retries && !isAbort(cause)) {
          attempt += 1;
          await sleep(backoff(attempt - 1, baseDelayMs, maxDelayMs), req.init.signal);
          continue;
        }
        throw cause;
      }
    }
  };
}
