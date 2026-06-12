/**
 * Framework-agnostic mock primitives. A `MockRoute` is a plain
 * `(ctx) => result` function — no MSW, no Next, no transport coupling — so the
 * SAME route set can be served three ways: server-side by the Next BFF route
 * handler (visible to RSC + middleware), and client/Node-side by the MSW adapter
 * (Expo dev + Vitest). One source of mock truth, many runtimes (ADR 0018).
 */

export type MockMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** What a handler receives — a runtime-neutral view of the request. */
export interface MockRequestContext {
  method: string;
  /** Request path with the API prefix already stripped, e.g. `/auth/login`. */
  path: string;
  /** Values captured from `:param` segments of the route pattern. */
  params: Record<string, string>;
  searchParams: URLSearchParams;
  /** Request headers — read `authorization`, `cookie`, etc. */
  headers: Headers;
  /**
   * True in runtimes with no refresh cookie (Expo/Vitest MSW): handlers may fall
   * back to the most-recent session. False under the BFF, where the cookie is
   * authoritative.
   */
  cookieLess: boolean;
  /** Lazily parse the JSON body; resolves `undefined` if there is none. */
  getBody: () => Promise<unknown>;
}

/** What a handler returns. The dispatcher turns this into a real response. */
export interface MockRouteResult {
  /** Response body, serialized as JSON verbatim. Omit for an empty body. */
  data?: unknown;
  /** HTTP status. Defaults to `200`, or `204` when `data` is omitted. */
  status?: number;
  /** Extra response headers, e.g. a `Set-Cookie`. */
  headers?: Record<string, string>;
}

export type MockHandler = (ctx: MockRequestContext) => MockRouteResult | Promise<MockRouteResult>;

export interface MockRoute {
  method: MockMethod;
  /** Path pattern relative to the API prefix; `:name` segments capture params. */
  pattern: string;
  handler: MockHandler;
}

/** A normalized response, runtime-neutral. `body === undefined` means no body. */
export interface MockResponse {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

/** Throw from a handler to short-circuit with a status + error envelope. */
export class MockHttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "MockHttpError";
    this.status = status;
    this.code = code;
  }
}
