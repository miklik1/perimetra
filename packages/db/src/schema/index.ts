/**
 * Schema aggregate — re-exports every module's schema directory. Used by
 * drizzle-kit (migrations/introspection) and the seed/privacy tooling, which
 * legitimately span modules.
 *
 * Application code must NOT import this barrel: `apps/api/src/modules/X`
 * imports `@repo/db/schema/X` only (ESLint-boundaries-enforced, ADR 0032) —
 * that restriction is what keeps modules extractable.
 *
 * Module schemas land with their modules (ADR 0032) — each gets
 * `export * from "./<module>";` here (`pnpm gen module` injects the line at
 * the @gen anchor below).
 */
export * from "./auth/index.js";
export * from "./outbox/index.js";
export * from "./audit/index.js";
export * from "./projects/index.js";
export * from "./releases/index.js";
export * from "./catalog-versions/index.js";
// @gen:schema-exports — `pnpm gen module` adds the new schema directory export here.
