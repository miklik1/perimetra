import { type User } from "@repo/validators";

/** A mock account: the public `user` plus the password the sign-in handler checks. */
export interface MockCredential {
  user: User;
  password: string;
}

/** The seed accounts every runtime boots with; `resetMockUsers` restores them. */
const SEED_CREDENTIALS: MockCredential[] = [
  {
    password: "password123",
    user: {
      id: "11111111-1111-4111-8111-111111111111",
      email: "ada@example.com",
      name: "Ada Lovelace",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  },
  {
    password: "hunter2",
    user: {
      id: "22222222-2222-4222-8222-222222222222",
      email: "alan@example.com",
      name: "Alan Turing",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  },
];

// Live list = the seeds plus any accounts created via `sign-up/email` this
// runtime. Module-global (mirrors the real DB the mock stands in for), so
// `resetMockUsers` truncates it back to the seeds for test isolation.
const mockCredentials: MockCredential[] = [...SEED_CREDENTIALS];

export function listMockUsers(): User[] {
  return mockCredentials.map((c) => c.user);
}

export function findUserByEmail(email: string): MockCredential | undefined {
  return mockCredentials.find((c) => c.user.email === email);
}

export function findUserById(id: string): User | undefined {
  return mockCredentials.find((c) => c.user.id === id)?.user;
}

/**
 * Register a new mock account (`sign-up/email`), added to the in-memory list so
 * a subsequent `sign-in`/`get-session` resolves it. Mock-only — no persistence,
 * no password hashing; the id is a throwaway uuid (the real backend mints
 * Better Auth nanoids). Callers guard uniqueness (`findUserByEmail`) first.
 */
export function createMockUser(input: { name: string; email: string; password: string }): User {
  const user: User = {
    id: crypto.randomUUID(),
    email: input.email,
    name: input.name,
    createdAt: new Date().toISOString(),
  };
  mockCredentials.push({ user, password: input.password });
  return user;
}

/** Test helper — drop sign-up-created accounts, restoring the seed users. */
export function resetMockUsers(): void {
  mockCredentials.length = 0;
  mockCredentials.push(...SEED_CREDENTIALS);
}
