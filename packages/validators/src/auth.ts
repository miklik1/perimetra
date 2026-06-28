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
