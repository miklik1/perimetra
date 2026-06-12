// Jest `setupFiles` — runs before the test framework + module graph. Skip the
// t3-env validation in `@repo/config/env/mobile` so any test whose import graph
// reaches it doesn't require real EXPO_PUBLIC_* vars. app.config.ts is never
// imported into the test graph (it has its own env side-effect) — see ADR 0005.
process.env.SKIP_ENV_VALIDATION = "true";
