// Re-exports the shared jsdom/jest-dom/cleanup setup (ADR 0025). Vitest loads it
// via `@repo/vitest-config/setup/react` (referenced from this package's
// vitest.config.ts); this thin local file stays only so tsconfig's `include`
// pulls in the jest-dom matcher types (the known toBeInTheDocument() gotcha).
import "@repo/vitest-config/setup/react";
