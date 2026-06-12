/**
 * @repo/model — the published product-model contract: schema types + the Expr
 * DSL (CORE_SPEC §2/§3). Pure and dependency-free; the engine, catalog, and
 * renderers all build on this barrel (ADR 0008).
 */
export * from "./catalog";
export * from "./expr";
export * from "./money";
export * from "./override";
export * from "./schema";
export * from "./validate";
