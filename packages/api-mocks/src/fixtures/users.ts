import { type User } from "@repo/validators";

/** A mock account: the public `user` plus the password the login handler checks. */
export interface MockCredential {
  user: User;
  password: string;
}

const mockCredentials: MockCredential[] = [
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
 * Mint a mock JWT (`header.payload.sig`, unsigned — the mock doesn't verify). The
 * payload carries `sub` (user id) and `exp` so the client's expiry handling and
 * SessionMonitor exercise real logic. Not cryptographically meaningful.
 */
export function mockJwt(user: User, ttlMs: number): string {
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({ sub: user.id, exp: Math.floor((Date.now() + ttlMs) / 1000) }),
  );
  return `${header}.${payload}.mock-signature`;
}

export function decodeMockJwt(token: string): { sub: string; exp: number } | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1]!)) as { sub?: unknown; exp?: unknown };
    if (typeof payload.sub === "string" && typeof payload.exp === "number") {
      return { sub: payload.sub, exp: payload.exp };
    }
    return null;
  } catch {
    return null;
  }
}

function base64Url(input: string): string {
  return btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(input: string): string {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  return atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
}
