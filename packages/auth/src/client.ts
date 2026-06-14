/* eslint-disable @typescript-eslint/no-unused-vars -- TS2883 portability
   anchor: declaration emit for the inferred client type below must be able to
   name these (they come from better-auth's deep dist paths otherwise). */
import type {
  AccessControl,
  InferSignUpEmailCtx,
  InferUserUpdateCtx,
  Role,
} from "better-auth/client";
/* eslint-enable @typescript-eslint/no-unused-vars */
import { adminClient, organizationClient } from "better-auth/client/plugins";
import { createAuthClient as createBetterAuthClient } from "better-auth/react";
import type { BetterAuthClientOptions } from "better-auth/types";

import { ac, orgAccessRoles } from "./permissions";

export interface AuthClientOptions {
  /**
   * Auth server origin. OMIT on web: the Next.js rewrite proxies `/api/auth/*`
   * same-origin to the API service, so the default relative base is correct
   * (and the session cookie stays first-party). Set the absolute API origin on
   * native, where there is no proxy.
   */
  baseURL?: string;
  /** Transport overrides — the test seam is `customFetchImpl`. */
  fetchOptions?: BetterAuthClientOptions["fetchOptions"];
}

/**
 * Build the app's Better Auth client (design §7.1). Sessions are httpOnly
 * cookies minted and refreshed by the API service — there is no client-held
 * token, JWT decoding, or refresh middleware anymore. The admin client plugin
 * is ON (user ban/unban + impersonation); the api-key plugin stays OFF
 * (version policy). Platform transports that need extra client plugins (the
 * Expo SecureStore plugin) build their own client in the app and inject it via
 * `<AuthProvider client={...}>` — same split as the old storage adapters.
 */
export function createAuthClient(options: AuthClientOptions = {}) {
  return createBetterAuthClient({
    baseURL: options.baseURL,
    fetchOptions: options.fetchOptions,
    // organizationClient (ADR 0057): the invite + member-management surface
    // (`organization.inviteMember / acceptInvitation / listMembers /
    // updateMemberRole / removeMember / setActive`, `useListOrganizations`),
    // carrying the SAME ac/roles as the server (`./permissions`) so role-typed
    // calls + any client `checkRolePermission` agree with server enforcement.
    plugins: [adminClient(), organizationClient({ ac, roles: orgAccessRoles })],
  });
}

export type AuthClient = ReturnType<typeof createAuthClient>;
