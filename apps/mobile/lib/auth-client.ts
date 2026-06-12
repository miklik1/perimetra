import { createAuthClient, type AuthClient } from "@repo/auth";

/**
 * Mobile Better Auth client — STUB (the mobile app is dormant). Lives in the
 * app, not `@repo/auth`, so the native transport can be injected without the
 * package depending on Expo — the same split the old storage adapter used.
 *
 * TODO(auth-mobile): wire the Better Auth Expo plugin so the session cookie is
 * persisted in SecureStore (no browser cookie jar on native) and OAuth deep
 * links resolve. The shape (verified against the Expo integration docs):
 *
 *   import { createAuthClient } from "better-auth/react";
 *   import { expoClient } from "@better-auth/expo/client";
 *   import * as SecureStore from "expo-secure-store";
 *
 *   createAuthClient({
 *     baseURL,                      // absolute API origin — no proxy on native
 *     plugins: [
 *       expoClient({ scheme: "mobile", storagePrefix: "mobile", storage: SecureStore }),
 *     ],
 *   });
 *
 * Prerequisites: add `@better-auth/expo` + `expo-secure-store`, add the app
 * scheme to the API service's `trustedOrigins`, and pass the built client to
 * `<AuthProvider client={...}>` (app/_layout.tsx already does). Until then
 * this plain client works in-session only: nothing persists across restarts.
 */
export function createMobileAuthClient(baseURL: string): AuthClient {
  return createAuthClient({ baseURL });
}
