/**
 * @repo/fixtures — authored model releases + the golden corpus (CORE_SPEC I2),
 * and the delta-0 proving harness. Test-only consumer of @repo/model +
 * @repo/engine; never imported by app or runtime code.
 */
export { slidingGateV1 } from "./releases/sliding-gate";
export * from "./golden/sliding-gate";
