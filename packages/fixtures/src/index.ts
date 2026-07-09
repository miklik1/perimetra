/**
 * @repo/fixtures — authored model releases + the golden corpus (CORE_SPEC I2),
 * and the delta-0 proving harness. Test-only consumer of @repo/model +
 * @repo/engine; never imported by app or runtime code.
 */
export { catalogV1 } from "./catalog/catalog-v1.js";
export { catalogV2 } from "./catalog/catalog-v2.js";
export { fenceRunV1 } from "./releases/fence-run.js";
export { slidingGateV1 } from "./releases/sliding-gate.js";
export { brankaV1 } from "./releases/branka.js";
export * from "./golden/sliding-gate.js";
export * from "./golden/branka.js";
export * from "./golden/fence-run.js";
export * from "./golden/site.js";
