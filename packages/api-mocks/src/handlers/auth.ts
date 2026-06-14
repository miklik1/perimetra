import { ACCESS_TOKEN_TTL_MS, REFRESH_TOKEN_COOKIE } from "@repo/config";
import { loginSchema } from "@repo/validators";

import { MockHttpError, type MockRoute } from "../core/types";
import { createSession, destroySession, resolveSession } from "../fixtures/session";
import { decodeMockJwt, findUserByEmail, findUserById, mockJwt } from "../fixtures/users";

function setRefreshCookie(token: string): string {
  return `${REFRESH_TOKEN_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000`;
}

function clearRefreshCookie(): string {
  return `${REFRESH_TOKEN_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}

function readCookie(headers: Headers, name: string): string | null {
  const cookie = headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

function bearerToken(headers: Headers): string | null {
  const authorization = headers.get("authorization");
  return authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
}

/**
 * Auth mock routes (ADR 0018). The request/response shapes match the documented
 * backend contract exactly so `@repo/api`/`@repo/auth` exercise real logic:
 * `login` returns `{ success, data: { accessToken, user } }`, `refresh` returns
 * `{ data: { accessToken } }`, `/v1/me` returns the bare user. Login sets an
 * httpOnly refresh cookie (server-visible through the BFF), so the Next
 * middleware gate and `/auth/refresh` work without a browser service worker.
 */
export const authRoutes: MockRoute[] = [
  {
    method: "POST",
    pattern: "/auth/login",
    handler: async ({ getBody }) => {
      const parsed = loginSchema.safeParse(await getBody());
      if (!parsed.success) throw new MockHttpError(422, "INVALID_INPUT", "Invalid input");

      const credential = findUserByEmail(parsed.data.email);
      if (!credential || credential.password !== parsed.data.password) {
        throw new MockHttpError(401, "INVALID_CREDENTIALS", "Invalid email or password");
      }

      const refreshToken = createSession(credential.user.id);
      return {
        data: {
          success: true,
          data: {
            accessToken: mockJwt(credential.user, ACCESS_TOKEN_TTL_MS),
            user: credential.user,
          },
        },
        headers: { "Set-Cookie": setRefreshCookie(refreshToken) },
      };
    },
  },
  {
    method: "POST",
    pattern: "/auth/refresh",
    handler: ({ headers, cookieLess }) => {
      const userId = resolveSession(readCookie(headers, REFRESH_TOKEN_COOKIE), cookieLess);
      const user = userId ? findUserById(userId) : undefined;
      if (!user) throw new MockHttpError(401, "INVALID_REFRESH", "No active session");
      return { data: { data: { accessToken: mockJwt(user, ACCESS_TOKEN_TTL_MS) } } };
    },
  },
  {
    method: "POST",
    pattern: "/auth/logout",
    handler: ({ headers, cookieLess }) => {
      destroySession(readCookie(headers, REFRESH_TOKEN_COOKIE), cookieLess);
      return { status: 204, headers: { "Set-Cookie": clearRefreshCookie() } };
    },
  },
  {
    method: "GET",
    pattern: "/v1/me",
    handler: ({ headers }) => {
      const token = bearerToken(headers);
      const decoded = token ? decodeMockJwt(token) : null;
      if (!decoded || decoded.exp * 1000 < Date.now()) {
        throw new MockHttpError(401, "UNAUTHENTICATED", "Invalid or expired token");
      }
      const user = findUserById(decoded.sub);
      if (!user) throw new MockHttpError(401, "UNAUTHENTICATED", "User not found");
      // Mock mode is single-tenant: the mock user is their org's admin (ADR 0056).
      return { data: { ...user, role: "admin" } };
    },
  },
];
