import { z } from "zod";

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
