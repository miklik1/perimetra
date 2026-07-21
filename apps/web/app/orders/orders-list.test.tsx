import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiProvider } from "@repo/api/react";
import { cs } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";

import { OrdersList } from "./orders-list";

// The role gate normally rides the real `/v1/me` session probe (mocked in
// vitest.setup.ts), but that mock hardcodes `role: "admin"` — there is no way to
// reach "workshop" through the HTTP mock. Mocking the hook directly is the
// narrowest lever: it exercises the SAME `hrefFor` branch orders-list.tsx reads
// off `useRole()`, without touching the shared MSW session wiring. Default
// (`null`) mirrors the real unauthenticated-in-test state (no sign-in flow runs
// here), so the default-role assertions below are unchanged behavior.
let mockRole: string | null = null;
vi.mock("../../lib/use-role", () => ({ useRole: () => mockRole }));

// A minimal `infiniteQueryOptions`-shaped override, used ONLY by the empty/error
// tests: swapping the `queryFn` is far less brittle than reaching into the
// shared MSW server (not exported by vitest.setup.ts) or spying on a
// source-file export. `null` (the default) falls through to the REAL
// `createOrdersQueries`, so every other test still exercises the actual
// endpoint factory against the mocked `/v1/orders` route.
type ListOverride = {
  queryKey: readonly unknown[];
  queryFn: () => Promise<{ items: never[]; nextCursor: null }>;
  initialPageParam: string;
  getNextPageParam: () => undefined;
};
let listOverride: ListOverride | null = null;

vi.mock("../../lib/orders-queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/orders-queries")>();
  return {
    ...actual,
    createOrdersQueries: (client: Parameters<typeof actual.createOrdersQueries>[0]) => {
      const real = actual.createOrdersQueries(client);
      return { ...real, list: () => listOverride ?? real.list() };
    },
  };
});

function emptyOverride(): ListOverride {
  return {
    queryKey: ["orders-test", "empty"],
    queryFn: async () => ({ items: [], nextCursor: null }),
    initialPageParam: "",
    getNextPageParam: () => undefined,
  };
}

function errorOverride(): ListOverride {
  return {
    queryKey: ["orders-test", "error"],
    queryFn: async () => {
      throw new Error("boom");
    },
    initialPageParam: "",
    getNextPageParam: () => undefined,
  };
}

// MSW (vitest.setup.ts) serves the `orders` mock group — 2 seeded orders
// (Z2026/0001 confirmed, Z2026/0002 in_production).
function renderList() {
  return render(
    <I18nProvider locale="cs" messages={cs}>
      <ApiProvider baseUrl="https://test.local/api">
        <OrdersList />
      </ApiProvider>
    </I18nProvider>,
  );
}

afterEach(() => {
  mockRole = null;
  listOverride = null;
});

describe("OrdersList", () => {
  it("renders the seeded orders with order numbers + status badges", async () => {
    renderList();
    expect(await screen.findByText("Z2026/0001")).toBeInTheDocument();
    expect(screen.getByText("Z2026/0002")).toBeInTheDocument();
    // Order status badges in Czech (confirmed / in_production).
    expect(screen.getByText("Potvrzeno")).toBeInTheDocument();
    expect(screen.getByText("Ve výrobě")).toBeInTheDocument();
  });

  it("never renders a money value — orders carry no price of their own", async () => {
    const { container } = renderList();
    await screen.findByText("Z2026/0001");
    expect(container.textContent).not.toMatch(/Kč/);
  });

  it("renders an accessible table with column headers", async () => {
    renderList();
    await screen.findByText("Z2026/0001");
    const table = screen.getByRole("table");
    const headers = within(table).getAllByRole("columnheader");
    expect(headers.map((h) => h.textContent)).toEqual(["Zakázka", "Stav", "Vytvořeno"]);
  });

  it("each row is a focusable link; default (non-workshop) role routes to the priced quote", async () => {
    renderList();
    const link = await screen.findByRole("link", { name: "Z2026/0001" });
    expect(link).toHaveAttribute("href", "/quotes/01910000-0000-7000-8000-000000000001");
  });

  it("workshop role split + price-blind", async () => {
    mockRole = "workshop";
    const { container } = renderList();
    const link = await screen.findByRole("link", { name: "Z2026/0001" });
    expect(link).toHaveAttribute("href", "/orders/01920000-0000-7000-8000-000000000001/production");
    expect(container.textContent).not.toMatch(/Kč/);
  });

  it("createdAt renders a locale-formatted date", async () => {
    renderList();
    await screen.findByText("Z2026/0001");
    expect(screen.getAllByText(/2026/).length).toBeGreaterThan(0);
  });
});

describe("OrdersList — empty and error states", () => {
  it("renders the empty state when there are no orders", async () => {
    listOverride = emptyOverride();
    renderList();
    expect(await screen.findByText("Zatím žádné zakázky.")).toBeInTheDocument();
    expect(screen.getByText("Zakázky se objeví po přijetí nabídky.")).toBeInTheDocument();
  });

  it("renders a live-region error on a failed load", async () => {
    listOverride = errorOverride();
    renderList();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
