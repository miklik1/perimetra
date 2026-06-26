// Pull in the shared jsdom/jest-dom/cleanup setup for its side effects: it
// registers the jest-dom matchers (so tsc sees `toBeInTheDocument` et al. via
// this file, which apps/web's tsconfig `include` covers) and the RTL cleanup.
// Vitest also lists it directly in setupFiles (vitest.config.ts); the duplicate
// import is idempotent.
import "@repo/vitest-config/setup/react";

import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll } from "vitest";

import {
  allRoutes,
  resetCustomers,
  resetProjects,
  resetQuotes,
  resetSessions,
} from "@repo/api-mocks";
import { createMswHandlers } from "@repo/api-mocks/msw";

// Web-app setup layered on top of the shared jsdom/jest-dom/cleanup setup
// (`@repo/vitest-config/setup/react`, wired via vitest.config.ts). This file
// owns only what's app-specific: the MSW node server lifecycle (ADR 0018).
//
// Test tier (ADR 0018): the same framework-agnostic mock routes the BFF serves
// in dev, run here through the MSW node server. `onUnhandledRequest: "error"`
// fails loudly on any unmocked request instead of hitting the network. RTL
// `cleanup` is registered by the shared setup; here we reset handlers + the
// mock sessions between tests.
const server = setupServer(...createMswHandlers(allRoutes));

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  resetSessions();
  resetProjects();
  resetQuotes();
  resetCustomers();
});
afterAll(() => server.close());
