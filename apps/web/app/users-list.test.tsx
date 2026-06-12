import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { keys, makeQueryClient } from "@repo/api";
import { ApiProvider } from "@repo/api/react";
import { cs } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";

import { UsersList } from "./users-list";

// Seed a QueryClient with the exact key `usersQueries.list()` writes to, then
// hand it to <ApiProvider> so the "use client" leaf reads it synchronously —
// same as a hydrated state from the RSC parent. Proves the queryOptions key +
// the leaf's useQuery (via useUsersQueries) line up. baseUrl is a placeholder:
// the cache hit means no request fires.
function renderWithSeededClient() {
  const qc = makeQueryClient();
  qc.setQueryData(keys.users.list(), [
    {
      id: "00000000-0000-0000-0000-000000000001",
      email: "ada@example.com",
      name: "Ada Lovelace",
      createdAt: "2024-01-01T00:00:00.000Z",
    },
  ]);
  return render(
    <I18nProvider locale="cs" messages={cs}>
      <ApiProvider baseUrl="https://test.local" initialQueryClient={qc}>
        <UsersList />
      </ApiProvider>
    </I18nProvider>,
  );
}

describe("UsersList", () => {
  it("renders the prefetched user", () => {
    renderWithSeededClient();
    expect(screen.getByText(/Ada Lovelace/)).toBeInTheDocument();
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
  });

  it("reads hydrated cache without entering loading state", () => {
    renderWithSeededClient();
    // Cache hit: status is "success", not "pending". The label is translated
    // (cs: "stav:"); the interpolated status value is what we assert on.
    expect(screen.getByText(/stav:/)).toHaveTextContent("success");
  });
});
