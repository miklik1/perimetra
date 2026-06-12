import { describe, expect, it } from "@jest/globals";
import { renderRouter, screen } from "expo-router/testing-library";

import { ApiProvider } from "@repo/api/react";

import Users from "../app/users";

// Like home.test.tsx, route tests live outside `app/` and mount an in-memory
// router. The Users screen reads the QueryClient via useUsersQueries/useQuery,
// so it needs an ApiProvider wrapper (the real app gets it from app/_layout.tsx).
// baseUrl is a placeholder pointing at no real host; useQuery starts in the
// loading state on mount, which is what we assert (no network needed).
function ApiWrapper({ children }: { children: React.ReactNode }) {
  return (
    <ApiProvider baseUrl="https://test.local" getToken={() => null}>
      {children}
    </ApiProvider>
  );
}

describe("Users screen", () => {
  it("renders the heading and the TanStack Query status readout", async () => {
    renderRouter({ users: Users }, { initialUrl: "/users", wrapper: ApiWrapper });

    expect(await screen.findByText("Users")).toBeOnTheScreen();
    // useQuery fires on mount; first frame is the pending state. The screen
    // mirrors web's users-list.tsx — status/fetchStatus drive the readout.
    expect(screen.getByText(/status: (pending|loading)/)).toBeOnTheScreen();
  });
});
