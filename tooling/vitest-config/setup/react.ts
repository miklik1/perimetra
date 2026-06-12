import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
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
