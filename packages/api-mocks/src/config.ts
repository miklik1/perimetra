import { type MockDispatchConfig } from "./core/dispatch";
import { type MockRoute } from "./core/types";
import { authRoutes } from "./handlers/auth";
import { customerRoutes } from "./handlers/customers";
import { lookupRoutes } from "./handlers/lookups";
import { orderRoutes } from "./handlers/orders";
import { projectRoutes } from "./handlers/projects";
import { quoteRoutes } from "./handlers/quotes";
import { userRoutes } from "./handlers/users";

// @gen:imports — `pnpm gen api-resource` adds the resource handler import here.

/**
 * Mock routes grouped by domain. Each group is independently toggleable via
 * `NEXT_PUBLIC_MSW_MOCKS`. As the real API ships an endpoint group, drop its
 * name from the selector — unmatched requests fall through to the real backend
 * (partial mocking), no code deletion (ADR 0018).
 */
export const routeGroups = {
  auth: authRoutes,
  users: userRoutes,
  projects: projectRoutes,
  quotes: quoteRoutes,
  orders: orderRoutes,
  customers: customerRoutes,
  lookups: lookupRoutes,
  // @gen:exports — `pnpm gen api-resource` registers the resource route group here.
} satisfies Record<string, MockRoute[]>;

type GroupName = keyof typeof routeGroups;

/**
 * Resolve the active routes from a comma-separated selector (e.g. `"auth"`).
 * Empty/undefined selector activates every group; unknown names are ignored.
 */
export function selectRoutes(selector?: string): MockRoute[] {
  const requested = (selector ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  const names = (requested.length ? requested : Object.keys(routeGroups)) as GroupName[];
  return names.flatMap((name) => routeGroups[name] ?? []);
}

/** Every mock route across all groups. */
export const allRoutes: MockRoute[] = Object.values(routeGroups).flat();

/**
 * Build a dispatch config for the BFF route handler. Defaults: mount under
 * `/api`, a small artificial latency so dev exercises loading states. Pass a
 * selector to scope which groups are mocked, or overrides to tune prefix/delay.
 */
export function createMockConfig(
  options: { selector?: string; overrides?: Partial<MockDispatchConfig> } = {},
): MockDispatchConfig {
  return {
    routes: selectRoutes(options.selector),
    prefix: "/api",
    delayRange: [50, 150],
    ...options.overrides,
  };
}
