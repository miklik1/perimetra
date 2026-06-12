import { z } from "zod";

export const userSchema = z.object({
  // Opaque server-assigned id — NOT a uuid: the real backend's user ids come
  // from Better Auth (32-char nanoid-style); only the mock fixtures happen to
  // use uuids. Caught by the real-stack smoke E2E (GET /v1/me failed the old
  // `z.uuid()` parse and the account page rendered an empty email).
  id: z.string().min(1),
  email: z.email(),
  name: z.string().min(1),
  createdAt: z.iso.datetime(),
});

export type User = z.infer<typeof userSchema>;

export const userListSchema = z.array(userSchema);

/**
 * One page of users (cursor-style pagination). `nextPage` is the next page
 * number, or `null` on the last page — fed straight into TanStack's
 * `getNextPageParam`.
 */
export const usersPageSchema = z.object({
  data: userListSchema,
  nextPage: z.number().int().positive().nullable(),
});

export type UsersPage = z.infer<typeof usersPageSchema>;

/**
 * Client → server input for creating a user. Derived from `userSchema` so the
 * field contracts (email format, non-empty name) stay in one place; `id` and
 * `createdAt` are server-assigned and therefore omitted. Consumed by both the
 * `@repo/api` create mutation and app-side form validation (RHF + zodResolver,
 * ADR 0009).
 */
export const createUserSchema = userSchema.pick({ name: true, email: true });

export type CreateUserInput = z.infer<typeof createUserSchema>;
