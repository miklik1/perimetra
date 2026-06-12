/**
 * pino redact paths (ADR 0036/0040): the static auth-material set plus every
 * PII-registry column name as a request/response body path — declaring a
 * column `pii()` in the schema is the ONLY step needed for it to be redacted
 * from logs. The schema import populates the registry as a side effect.
 */
import { piiColumnNames } from "@repo/db/pii";

import "@repo/db/schema";

const STATIC_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'res.headers["set-cookie"]',
];

export function buildRedactPaths(): string[] {
  return [
    ...STATIC_PATHS,
    ...piiColumnNames().flatMap((name) => [`req.body.${name}`, `res.body.${name}`]),
  ];
}
