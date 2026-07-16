/**
 * pino redact paths (ADR 0036/0040): the static auth-material set plus every
 * PII-registry column name as a request/response body path — declaring a
 * column `pii()` in the schema is the ONLY step needed for it to be redacted
 * from logs. The schema import populates the registry as a side effect.
 *
 * `piiBodyKeys()` emits both the snake_case and camelCase form of each column,
 * so a multi-word column (`ip_address`) is redacted under the casing the body /
 * Drizzle row actually uses (`ipAddress`) — a snake-only path silently no-ops.
 */
import { stdSerializers } from "pino";

import { piiBodyKeys } from "@repo/db/pii";

import "@repo/db/schema";

const STATIC_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  // A browser that opened a token-bearing URL (a password-reset / magic /
  // signed-export link — `sendResetPassword` already mints one) replays that URL
  // as the `Referer` of the next same-origin request, so a single-use credential
  // can land in the access log in cleartext. Whole-header censor via pino
  // `redact.paths` — the SAME mechanism as cookie/authorization, NOT a serializer
  // edit (ADR 0040 amendment, channel-A drain of skeleton 7e9ba3b).
  "req.headers.referer",
  'res.headers["set-cookie"]',
];

export function buildRedactPaths(): string[] {
  return [
    ...STATIC_PATHS,
    ...piiBodyKeys().flatMap((name) => [`req.body.${name}`, `res.body.${name}`]),
  ];
}

/**
 * A redact PATH cannot reach a value spliced into a STRING. pino's stock request
 * serializer logs `url` including the querystring, AND emits the parsed `query`
 * object. A redact path can reach `req.query.<key>` but only BY KEY — and a
 * search param's key (`q`) is not a schema column, so a `?q=<email>` search over
 * a `pii()` column can't be reached by a pii()-derived path on either surface.
 * The instant any endpoint grows such a search, the term lands in every
 * completion log line and any Sentry breadcrumb built from it, in cleartext.
 *
 * Both query surfaces are closed fail-closed at this one shared source: the
 * querystring is cut from the `url` string, and the parsed `query` object is
 * dropped entirely (dropping is the only GENERIC guarantee — we cannot know
 * which param key carries PII). A project that needs specific non-PII params
 * (`cursor`, `limit`, `status`) in logs re-adds them deliberately.
 */
export function stripQueryString(url: string): string {
  const cut = url.indexOf("?");
  return cut === -1 ? url : url.slice(0, cut);
}

/**
 * Reshape pino-http's request log line: cut the querystring from `url` and drop
 * the parsed `query` object.
 *
 * IMPORTANT: pino-http PRE-serializes the request (via pino-std-serializers'
 * `wrapRequestSerializer`) before handing it to a custom `req` serializer, so
 * this receives the ALREADY-serialized shape. It must NOT call
 * `stdSerializers.req` again — re-serializing an object that has no `socket`
 * recomputes `remoteAddress`/`remotePort` as undefined and silently drops them
 * from every log line. Only reshape the serialized object here.
 */
export function redactedReqSerializer(
  req: ReturnType<typeof stdSerializers.req>,
): ReturnType<typeof stdSerializers.req> {
  const serialized = { ...req, url: stripQueryString(req.url) };
  delete (serialized as Record<string, unknown>).query;
  return serialized;
}
