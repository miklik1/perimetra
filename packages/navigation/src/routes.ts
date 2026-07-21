import { z } from "zod";

/**
 * The single, const-asserted route registry both platforms derive typed paths
 * and param shapes from (ADR 0003). Path templates use `:name` placeholders;
 * declare any placeholder in the matching `params` map. Keep `params` keys in
 * sync with the template — `buildPath` substitutes them at runtime and the
 * `ParamsOf<RouteName>` type derives the static shape from the same source.
 *
 * A route may also declare an optional `search` zod schema (ADR 0022): it
 * types `Href`'s `query`, drives `buildPath`'s serialization, and is what
 * `useSearchParams(route)` parses through (coercion + defaults). Search params
 * are user-editable, so every field MUST be `.optional()` or `.default(…)` —
 * parsing falls back instead of throwing.
 */
export const routes = {
  home: { path: "/" },
  users: {
    path: "/users",
    search: z.object({
      page: z.coerce.number().int().positive().default(1),
      sort: z.enum(["name", "date"]).optional(),
    }),
  },
  user: { path: "/users/:id", params: { id: "string" } },
  login: { path: "/login" },
  // Settings section index (ADR 0118 §4.1 / 1c-2). `/settings` is the tabbed
  // shell Nastavení points at; it redirects to the first tab (`/account`). Its
  // sibling surfaces keep their own URLs (`/account`, `/account/security`,
  // `/team`, `/team/legal-profile`, `/admin`) and render the shared tab strip.
  settings: { path: "/settings" },
  account: { path: "/account" },
  // The 2FA/security sub-tab of the account section — a named route so the
  // settings tab strip links it typed, like every other tab.
  accountSecurity: { path: "/account/security" },
  team: { path: "/team" },
  // The org legal-profile (dodavatel identity) — a settings tab (1c-2). Named so
  // the tab strip and cross-links reference it typed rather than via a raw href.
  legalProfile: { path: "/team/legal-profile" },
  acceptInvitation: {
    path: "/accept-invitation/:invitationId",
    params: { invitationId: "string" },
  },
  projects: { path: "/projects" },
  configurator: { path: "/configurator" },
  site: { path: "/site/:projectId", params: { projectId: "string" } },
  quotes: { path: "/quotes" },
  quote: { path: "/quotes/:id", params: { id: "string" } },
  // Orders surface (ADR 0109 / ADR-O1, CAR-156) — the workshop's build queue.
  // The production/traveler sub-routes use raw string hrefs (like /quotes'), so
  // only the list needs a typed entry (the nav registry's `to: Href` requires it).
  orders: { path: "/orders" },
  // Odběratel management surface (ADR 0082 backend, CAR-23 UI) — admin/sales
  // only (workshop is 403'd by the api; the nav entry's show-predicate mirrors it).
  customers: { path: "/customers" },
  customer: { path: "/customers/:id", params: { id: "string" } },
  // Buyer-facing PUBLIC nabídka (ADR 0089) — token-credentialed, no session.
  // Deliberately OUTSIDE the `/quotes` protected prefix (proxy.ts auth gate).
  sharedNabidka: { path: "/nabidka/:token", params: { token: "string" } },
  // Org-admin price-table console (ADR 0056/0061) and the platform/vendor
  // console (ADR 0062) — added for the nav shell (CAR-12) so both surfaces
  // are typed `Href`s like everything else, instead of the raw string hrefs
  // `account-client.tsx` used before the registry covered them.
  admin: { path: "/admin" },
  platform: { path: "/platform" },
  // @gen:exports — `pnpm gen route` registers the new route entry here.
} as const;

export type RouteName = keyof typeof routes;
