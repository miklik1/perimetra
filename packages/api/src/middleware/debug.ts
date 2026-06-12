import { createLogger } from "@repo/utils";

import { type ApiMiddleware } from "../client/create-api-client";
import { recordApiLog } from "./api-log-store";

export interface DebugMiddlewareOptions {
  /** Also push each request into the in-memory ring buffer (`getApiLog`). */
  record?: boolean;
}

/**
 * Dev-only request/response/timing logger as injectable middleware (ADR 0012).
 * Tree-shakeable: `@repo/api` never imports it on a default path, and the app
 * composes it ONLY behind a dev flag (e.g. `NEXT_PUBLIC_DEBUG_API`), so it never
 * enters a production bundle. Place it OUTERMOST to time the whole chain
 * (including retries/refresh). The middleware itself reads no env — the app owns
 * the gate, keeping `@repo/api` env-free.
 */
export function createDebugMiddleware(options: DebugMiddlewareOptions = {}): ApiMiddleware {
  const log = createLogger({ level: "debug", scope: "api" });
  return async (req, next) => {
    const method = (req.init.method ?? "GET").toUpperCase();
    const start = Date.now();
    try {
      const response = await next(req);
      const durationMs = Date.now() - start;
      log.debug(`${method} ${req.url} → ${response.status}`, { durationMs });
      if (options.record)
        recordApiLog({ method, url: req.url, status: response.status, durationMs });
      return response;
    } catch (error) {
      const durationMs = Date.now() - start;
      log.error(`${method} ${req.url} → failed`, { durationMs, error });
      if (options.record) {
        recordApiLog({ method, url: req.url, status: 0, durationMs, error: String(error) });
      }
      throw error;
    }
  };
}
