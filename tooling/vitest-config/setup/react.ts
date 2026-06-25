import "@testing-library/jest-dom/vitest";

import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * Shared jsdom/RTL setup (ADR 0025): register the jest-dom matchers and unmount
 * the rendered tree after each test so component suites don't leak DOM between
 * cases. This is the file every jsdom package duplicated as its local
 * `vitest.setup.ts`; it is now consumed via `@repo/vitest-config/setup/react`
 * from `reactConfig`. A package that needs more (e.g. an MSW server lifecycle)
 * adds its own setup file alongside this one.
 */
afterEach(cleanup);

// Testing Library's findBy*/waitFor have their OWN async deadline
// (`asyncUtilTimeout`, default 1000ms) — independent of vitest's `testTimeout`.
// When `turbo run test` fans ~14 suites out at once, an MSW + react-query data
// load can exceed 1000ms, so an otherwise-passing query trips it — a DIFFERENT
// suite each run ("Unable to find role=…"). Raise it generously (still well
// under the base `testTimeout` so a genuine never-resolve fails at the ceiling,
// and a real assertion still fails immediately). Pairs with the
// `testTimeout`/`hookTimeout` raise in `@repo/vitest-config/base`. (Channel-A
// drain from skeleton f506bec.)
configure({ asyncUtilTimeout: 15_000 });
