import { logger } from "@repo/utils";
import { apiErrorEnvelopeSchema } from "@repo/validators";

/** Which layer produced the failure — HTTP status, transport, or decoding. */
export type ApiErrorKind = "http" | "network" | "parse";

/**
 * One normalized error shape for every failure mode. `status` is the HTTP
 * status for `"http"`, and `0` for `"network"`/`"parse"` (no response status).
 */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number;
  readonly code?: string;
  readonly body?: unknown;
  /**
   * Field-level validation errors keyed by form field path (from the error
   * envelope's `errors`). RHF surfaces these via `setError` (ADR 0009/0014).
   */
  readonly fieldErrors?: Record<string, string[]>;
  /**
   * Parsed `Retry-After` delay in milliseconds for `429`/`503`, when the server
   * sent one. Consumed by the retry middleware.
   */
  readonly retryAfterMs?: number;

  constructor(args: {
    kind: ApiErrorKind;
    status: number;
    message: string;
    code?: string;
    body?: unknown;
    fieldErrors?: Record<string, string[]>;
    retryAfterMs?: number;
  }) {
    super(args.message);
    this.name = "ApiError";
    this.kind = args.kind;
    this.status = args.status;
    this.code = args.code;
    this.body = args.body;
    this.fieldErrors = args.fieldErrors;
    this.retryAfterMs = args.retryAfterMs;
  }
}

/**
 * Parse an HTTP `Retry-After` header into milliseconds. Accepts a delta in
 * seconds (`"120"`) or an HTTP-date (`"Wed, 21 Oct 2025 07:28:00 GMT"`).
 * Returns `undefined` when absent or unparseable.
 */
export function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - Date.now());
}

/**
 * Bodies that `fetch` already knows how to serialize — passed through untouched
 * (no `JSON.stringify`, no forced `Content-Type`) so multipart boundaries,
 * uploads, and pre-encoded payloads survive. Everything else is treated as a
 * plain object and JSON-encoded.
 */
function isRawBody(body: unknown): boolean {
  return (
    typeof body === "string" ||
    body instanceof FormData ||
    body instanceof Blob ||
    body instanceof ArrayBuffer ||
    body instanceof URLSearchParams ||
    ArrayBuffer.isView(body) ||
    (typeof ReadableStream !== "undefined" && body instanceof ReadableStream)
  );
}

/** Join base + path without producing a `//`, and let absolute URLs pass through. */
function joinUrl(baseUrl: string, path: string): string {
  if (path.startsWith("http")) return path;
  if (!baseUrl) return path;
  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

/**
 * True when the bearer may ride on a request to `resolvedUrl`. Credential
 * headers may be attached only for a relative request or an absolute one that
 * shares the `baseUrl` origin: `joinUrl` lets an absolute `path` pass through
 * verbatim, so without this gate a request to `https://evil.com/x` would carry
 * the token to a foreign origin (exfil). Uses the WHATWG `URL` constructor
 * (browsers, Node 18+, Hermes/RN).
 *
 * Fails CLOSED for an absolute resolved URL whose base has no parseable origin:
 * a RELATIVE `baseUrl` (e.g. the web client's `"/api"`) means every legitimate
 * request is itself relative, so an absolute resolved URL against it is by
 * definition cross-origin and must NOT carry the bearer.
 */
function isSameOrigin(baseUrl: string, resolvedUrl: string): boolean {
  if (!resolvedUrl.startsWith("http")) return true;
  let baseOrigin: string;
  try {
    baseOrigin = new URL(baseUrl).origin;
  } catch {
    return false;
  }
  try {
    return new URL(resolvedUrl).origin === baseOrigin;
  } catch {
    return false;
  }
}

/** The resolved request handed to the middleware chain and, finally, `fetch`. */
export interface ApiRequest {
  url: string;
  init: RequestInit;
}

/**
 * A link in the transport chain. Wraps the network call: inspect/mutate the
 * `req`, call `next` to continue (or short-circuit by returning your own
 * `Response`), and post-process the result. Composed left-to-right around the
 * terminal `fetch` — the first middleware is outermost.
 */
export type ApiMiddleware = (
  req: ApiRequest,
  next: (req: ApiRequest) => Promise<Response>,
) => Promise<Response>;

/**
 * Server response-envelope seam (ADR 0030). Backends that wrap every payload
 * (e.g. `{ success, data, timestamp }`) get unwrapped in ONE place — endpoint
 * `parse` validators and call sites see the inner payload only, so swapping
 * backends (or removing the envelope) never touches endpoint code.
 */
export interface ResponseEnvelopeConfig {
  /**
   * Applied to every 2xx JSON body before the per-call `parse`. A throw is
   * normalized into a `"parse"` `ApiError` (the body didn't match the
   * envelope the client was configured for).
   */
  unwrap?: (data: unknown) => unknown;
  /**
   * Maps a non-2xx JSON body onto `ApiError` fields for backends whose error
   * envelope differs from the default `apiErrorEnvelopeSchema`. Return
   * `undefined` to fall back to the default schema (and ultimately the HTTP
   * status text). The raw body always lands on `ApiError.body` either way.
   */
  mapError?: (body: unknown) => {
    message?: string;
    code?: string;
    fieldErrors?: Record<string, string[]>;
  } | void;
}

export interface ApiClientConfig {
  /** Base URL, e.g. `https://api.example.com`. Passed by the app from env. */
  baseUrl: string;
  /**
   * Returns the auth token (or null). Supplied by the app so web cookies vs
   * RN SecureStore stay app-side.
   */
  getToken?: () => string | null | Promise<string | null>;
  /** Cross-cutting transport concerns: logging, retry, 401-refresh, etc. */
  middleware?: ApiMiddleware[];
  /** Response-envelope unwrapping + error mapping (ADR 0030). */
  envelope?: ResponseEnvelopeConfig;
  /**
   * Terminal transport. Defaults to the global `fetch`. Inject a custom one to
   * resolve requests without the network — e.g. the web RSC client calls the
   * BFF route handler in-process (no HTTP self-hop), and tests can stub it.
   */
  fetch?: typeof fetch;
}

export interface ApiFetchOptions<T> extends Omit<RequestInit, "body"> {
  /** JSON-serialized automatically; sets `Content-Type: application/json`. */
  body?: unknown;
  /**
   * Optional validation at the trust boundary (e.g. a zod `.parse`). Run only
   * on a 2xx body; a throw becomes a `"parse"` `ApiError`.
   */
  parse?: (data: unknown) => T;
}

/** A configured transport: one `apiFetch` bound to a base URL + auth + chain. */
export interface ApiClient {
  apiFetch: <T>(path: string, options?: ApiFetchOptions<T>) => Promise<T>;
}

/**
 * Builds a transport bound to its config — no module-global state, so each
 * runtime (browser, RN, RSC server) constructs and owns its own client. The
 * returned `apiFetch` resolves the URL against the base, injects JSON + bearer
 * auth, pipes the request through the middleware chain, and normalizes every
 * failure into one `ApiError`.
 */
export function createApiClient(config: ApiClientConfig): ApiClient {
  // Resolve the GLOBAL `fetch` at call time (not construction time) so a later
  // global patch — e.g. MSW in tests — is honored. An injected `config.fetch`
  // (the in-process RSC transport) is used as-is.
  const terminal = config.fetch
    ? (req: ApiRequest) => config.fetch!(req.url, req.init)
    : (req: ApiRequest) => fetch(req.url, req.init);
  // Compose middleware around the terminal `fetch`. reduceRight makes the first
  // entry outermost: mw[0] -> mw[1] -> ... -> fetch.
  const dispatch = (config.middleware ?? []).reduceRight<(req: ApiRequest) => Promise<Response>>(
    (next, middleware) => (req) => middleware(req, next),
    terminal,
  );

  async function apiFetch<T>(path: string, options: ApiFetchOptions<T> = {}): Promise<T> {
    const { body, parse, headers, ...rest } = options;
    const finalHeaders = new Headers(headers);
    const rawBody = isRawBody(body);
    // Only JSON-encoded plain objects get the JSON content-type; raw bodies keep
    // whatever `fetch` infers (e.g. the multipart boundary for FormData).
    if (body !== undefined && !rawBody && !finalHeaders.has("Content-Type")) {
      finalHeaders.set("Content-Type", "application/json");
    }

    const url = joinUrl(config.baseUrl, path);

    // Resolve the URL first, then attach the bearer only when it stays on the
    // configured origin (or the path is relative). Prevents leaking the token to
    // a foreign origin when `path` is an absolute cross-origin URL.
    const token = config.getToken ? await config.getToken() : null;
    if (token && isSameOrigin(config.baseUrl, url)) {
      finalHeaders.set("Authorization", `Bearer ${token}`);
    }
    const request: ApiRequest = {
      url,
      init: {
        ...rest,
        headers: finalHeaders,
        body:
          body === undefined
            ? undefined
            : rawBody
              ? (body as RequestInit["body"])
              : JSON.stringify(body),
      },
    };

    let response: Response;
    try {
      response = await dispatch(request);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Network request failed";
      logger.error("apiFetch network error", { url, cause });
      throw new ApiError({ kind: "network", status: 0, message });
    }

    if (response.status === 204) return undefined as T;

    const text = await response.text();
    let data: unknown;
    if (text.length > 0) {
      try {
        data = JSON.parse(text);
      } catch {
        if (!response.ok) {
          throw new ApiError({
            kind: "http",
            status: response.status,
            message: response.statusText || "Request failed",
            body: text,
          });
        }
        throw new ApiError({
          kind: "parse",
          status: response.status,
          message: "Failed to parse response body",
          body: text,
        });
      }
    }

    if (!response.ok) {
      // A configured `mapError` (ADR 0030) wins; when absent or it declines
      // (returns undefined), the default envelope schema is the fallback.
      const mapped = config.envelope?.mapError?.(data) ?? undefined;
      const envelope = mapped ? undefined : apiErrorEnvelopeSchema.safeParse(data);
      throw new ApiError({
        kind: "http",
        status: response.status,
        message:
          mapped?.message ??
          (envelope?.success ? envelope.data.message : response.statusText || "Request failed"),
        code: mapped?.code ?? (envelope?.success ? envelope.data.code : undefined),
        body: data,
        fieldErrors: mapped?.fieldErrors ?? (envelope?.success ? envelope.data.errors : undefined),
        retryAfterMs: parseRetryAfter(response.headers.get("Retry-After")),
      });
    }

    if (config.envelope?.unwrap !== undefined && data !== undefined) {
      try {
        data = config.envelope.unwrap(data);
      } catch (cause) {
        logger.error("apiFetch envelope unwrap failed", { url, cause });
        throw new ApiError({
          kind: "parse",
          status: response.status,
          message: "Response envelope unwrap failed",
          body: data,
        });
      }
    }

    if (parse) {
      try {
        return parse(data);
      } catch (cause) {
        logger.error("apiFetch response validation failed", { url, cause });
        throw new ApiError({
          kind: "parse",
          status: response.status,
          message: "Response failed validation",
          body: data,
        });
      }
    }

    return data as T;
  }

  return { apiFetch };
}
