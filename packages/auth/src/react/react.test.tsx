/** @vitest-environment jsdom */
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { ApiProvider } from "@repo/api/react";

import { createAuthClient, type AuthClient } from "../client";
import { AuthGuard } from "./auth-guard";
import { AuthProvider } from "./auth-provider";
import { useAuth } from "./use-auth";

const sessionUser = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "ada@example.com",
  name: "Ada",
  emailVerified: true,
  image: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const sessionBody = {
  user: sessionUser,
  session: {
    id: "session-1",
    token: "session-token",
    userId: sessionUser.id,
    expiresAt: "2027-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * A REAL Better Auth client over a faked transport (`customFetchImpl` — the
 * package's test seam), so `useSession`'s store/fetch wiring is exercised, not
 * mocked. The handler is stateful: sign-out flips the session to null, which
 * the client's post-signout session refetch then observes.
 */
function makeClient(opts: { authenticated: boolean }): AuthClient {
  const state = { authenticated: opts.authenticated };
  return createAuthClient({
    baseURL: "http://auth.test",
    fetchOptions: {
      customFetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/get-session")) return json(state.authenticated ? sessionBody : null);
        if (url.includes("/sign-out")) {
          state.authenticated = false;
          return json({ success: true });
        }
        return json({ message: "not found" }, 404);
      },
    },
  });
}

function wrapper(client: AuthClient) {
  const Wrap = ({ children }: { children: ReactNode }) => (
    <ApiProvider baseUrl="http://api.test">
      <AuthProvider client={client}>{children}</AuthProvider>
    </ApiProvider>
  );
  Wrap.displayName = "TestWrap";
  return Wrap;
}

describe("useAuth", () => {
  it("throws outside <AuthProvider> (but inside <ApiProvider>)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onlyApi = ({ children }: { children: ReactNode }) => (
      <ApiProvider baseUrl="http://api.test">{children}</ApiProvider>
    );
    expect(() => renderHook(() => useAuth(), { wrapper: onlyApi })).toThrow(
      /within <AuthProvider>/,
    );
    vi.restoreAllMocks();
  });

  it("resolves the cookie session and maps the user onto the @repo/validators contract", async () => {
    const { result } = renderHook(() => useAuth(), {
      wrapper: wrapper(makeClient({ authenticated: true })),
    });
    // Before the session fetch resolves, nothing is asserted as authenticated.
    expect(result.current.sessionValidated).toBe(false);
    expect(result.current.isAuthenticated).toBe(false);

    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    expect(result.current.sessionValidated).toBe(true);
    expect(result.current.user).toEqual({
      id: sessionUser.id,
      email: sessionUser.email,
      name: sessionUser.name,
      createdAt: sessionUser.createdAt,
    });
  });

  it("resolves unauthenticated when the server has no session", async () => {
    const { result } = renderHook(() => useAuth(), {
      wrapper: wrapper(makeClient({ authenticated: false })),
    });
    await waitFor(() => expect(result.current.sessionValidated).toBe(true));
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it("logout revokes the session and flips every subscriber to signed-out", async () => {
    const { result } = renderHook(() => useAuth(), {
      wrapper: wrapper(makeClient({ authenticated: true })),
    });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    await act(() => result.current.logout());

    await waitFor(() => expect(result.current.isAuthenticated).toBe(false));
    expect(result.current.user).toBeNull();
  });
});

describe("AuthGuard", () => {
  it("shows fallback while the session resolves, then renders children when authenticated", async () => {
    render(
      <AuthGuard redirect={vi.fn()} fallback={<span>loading</span>}>
        secret
      </AuthGuard>,
      { wrapper: wrapper(makeClient({ authenticated: true })) },
    );
    expect(screen.getByText("loading")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("secret")).toBeInTheDocument());
  });

  it("redirects once the session resolves unauthenticated (never shows children)", async () => {
    const redirect = vi.fn();
    render(
      <AuthGuard redirect={redirect} fallback={<span>loading</span>}>
        secret
      </AuthGuard>,
      { wrapper: wrapper(makeClient({ authenticated: false })) },
    );
    expect(screen.getByText("loading")).toBeInTheDocument();
    await waitFor(() => expect(redirect).toHaveBeenCalled());
    expect(screen.queryByText("secret")).not.toBeInTheDocument();
  });
});
