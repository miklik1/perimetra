/**
 * @repo/model — the published product-model contract: schema types + the Expr
 * DSL (CORE_SPEC §2/§3). Pure and dependency-free; the engine, catalog, and
 * renderers all build on this barrel (ADR 0008).
 */
export * from "./catalog.js";
export * from "./expr.js";
export * from "./money.js";
export * from "./override.js";
export * from "./schema.js";
export * from "./site.js";
export * from "./tax.js";
export * from "./ui.js";
export * from "./validate.js";
