/**
 * @repo/engine — the generic product-model interpreter (CORE_SPEC §5): cascade
 * → constraints → derivation → emission. Pure (no I/O); consumes @repo/model.
 */
export * from "./types";
export * from "./scope";
export * from "./constraints";
export * from "./derive";
export * from "./emit";
export * from "./pipeline";
