// Root barrel exposes ONLY platform-neutral constants. The env modules are
// reached via the explicit `@repo/config/env/web` and `@repo/config/env/mobile`
// subpaths so a platform's env code (and its @t3-oss preset) never leaks into
// the other platform's bundle.
export * from "./constants";
