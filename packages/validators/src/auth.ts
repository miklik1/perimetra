import { z } from "zod";

import { userSchema } from "./user";

/**
 * Client → server login input. Email + password, validated identically by the
 * web login form (RHF + zodResolver, ADR 0009) and parsed at the API seam. The
 * password contract is intentionally permissive here — login only proves
 * possession of an existing credential; strength rules belong on registration.
 */
export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export type LoginInput = z.infer<typeof loginSchema>;

/**
 * `POST /auth/login` response envelope. The short-lived access token is returned
 * in the body (held in memory by `@repo/auth`'s token-manager); the long-lived
 * refresh token is set as an httpOnly cookie by the server and never touches JS.
 * `userSchema` is reused so the user contract stays single-sourced.
 */
export const loginResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    accessToken: z.string().min(1),
    user: userSchema,
  }),
});

export type LoginResponse = z.infer<typeof loginResponseSchema>;

/**
 * `POST /auth/refresh` response envelope. Only a fresh access token comes back —
 * the rotated refresh token rides in a new httpOnly `Set-Cookie`. Parsed by the
 * refresh flow in `@repo/auth` (bare fetch, outside the middleware chain).
 */
export const refreshResponseSchema = z.object({
  data: z.object({
    accessToken: z.string().min(1),
  }),
});

export type RefreshResponse = z.infer<typeof refreshResponseSchema>;

/**
 * The persisted auth session (user identity only — never tokens). Validated when
 * rehydrating from platform storage (web `localStorage`, mobile secure-store),
 * which is a trust boundary: a stale/tampered value must not hydrate an invalid
 * `User` into the store (ADR 0014 — parse at the boundary).
 */
export const authSessionSchema = z.object({
  user: userSchema,
});

export type AuthSession = z.infer<typeof authSessionSchema>;
