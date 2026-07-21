import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiProvider } from "@repo/api/react";
import { cs } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";

import { CustomersList } from "./customers-list";

// A minimal `infiniteQueryOptions`-shaped override, used ONLY by the
// archived-styling test: swapping the `queryFn` is far less brittle than
// reaching into the shared MSW server (not exported by vitest.setup.ts) or
// mutating the shared customer fixtures (neither seeded row is archived).
// `null` (the default) falls through to the REAL `createCustomersQueries`, so
// every other test still exercises the actual endpoint factory against the
// mocked `/v1/customers` route.
type ListOverride = {
  queryKey: readonly unknown[];
  queryFn: () => Promise<{
    items: Array<{
      id: string;
      name: string;
      ico: string | null;
      city: string | null;
      status: string;
    }>;
    nextCursor: null;
  }>;
  initialPageParam: string;
  getNextPageParam: () => undefined;
};
let listOverride: ListOverride | null = null;

vi.mock("../../lib/customers-queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/customers-queries")>();
  return {
    ...actual,
    createCustomersQueries: (client: Parameters<typeof actual.createCustomersQueries>[0]) => {
      const real = actual.createCustomersQueries(client);
      return {
        ...real,
        list: (filters?: Parameters<typeof real.list>[0]) => listOverride ?? real.list(filters),
      };
    },
  };
});

function archivedOverride(): ListOverride {
  return {
    queryKey: ["customers-test", "archived"],
    queryFn: async () => ({
      items: [
        {
          id: "00000000-0000-7000-9000-000000000099",
          name: "Zaniklá s.r.o.",
          ico: null,
          city: null,
          status: "archived",
        },
      ],
      nextCursor: null,
    }),
    initialPageParam: "",
    getNextPageParam: () => undefined,
  };
}

// MSW (vitest.setup.ts) serves the `customers` mock group — 2 seeded rows
// ("Bartek Vrata s.r.o." ico 27074358, "Jan Novák" city Brno), reseeded per test.
function renderList() {
  return render(
    <I18nProvider locale="cs" messages={cs}>
      <ApiProvider baseUrl="https://test.local/api">
        <CustomersList />
      </ApiProvider>
    </I18nProvider>,
  );
}

afterEach(() => {
  listOverride = null;
});

describe("CustomersList", () => {
  it("renders the seeded customers", async () => {
    renderList();
    expect(await screen.findByText("Bartek Vrata s.r.o.")).toBeInTheDocument();
    expect(screen.getByText("Jan Novák")).toBeInTheDocument();
  });

  it("renders an accessible table with the name/ico/city/status columns", async () => {
    renderList();
    await screen.findByText("Bartek Vrata s.r.o.");
    const table = screen.getByRole("table");
    const headers = within(table).getAllByRole("columnheader");
    expect(headers.map((h) => h.textContent)).toEqual(["Zákazník", "IČO", "Město", "Stav"]);
  });

  it("each row is a focusable stretched-link to the customer detail", async () => {
    renderList();
    const link = await screen.findByRole("link", { name: "Bartek Vrata s.r.o." });
    expect(link).toHaveAttribute("href", "/customers/00000000-0000-7000-9000-000000000001");
  });

  it("shows ICO/city with a dash fallback when absent", async () => {
    renderList();
    await screen.findByText("Jan Novák");
    // Jan Novák has no ico, so at least one dash fallback renders (Bartek's
    // city is also absent, so there are two).
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.getByText("27074358")).toBeInTheDocument();
    expect(screen.getByText("Brno")).toBeInTheDocument();
  });

  it("shows an active status badge for every seeded (active) row", async () => {
    renderList();
    await screen.findByText("Bartek Vrata s.r.o.");
    expect(screen.getAllByText("Aktivní").length).toBe(2);
  });

  it("the search box filters the list by NAME substring (calls list() with `search`)", async () => {
    renderList();
    await screen.findByText("Jan Novák");

    fireEvent.change(screen.getByPlaceholderText("Hledat podle názvu nebo IČO…"), {
      target: { value: "Bartek" },
    });

    await waitFor(() => expect(screen.queryByText("Jan Novák")).not.toBeInTheDocument());
    expect(screen.getByText("Bartek Vrata s.r.o.")).toBeInTheDocument();
  });

  it("the search box also filters by IČO substring", async () => {
    renderList();
    await screen.findByText("Jan Novák");

    fireEvent.change(screen.getByPlaceholderText("Hledat podle názvu nebo IČO…"), {
      target: { value: "270743" },
    });

    await waitFor(() => expect(screen.queryByText("Jan Novák")).not.toBeInTheDocument());
    expect(screen.getByText("Bartek Vrata s.r.o.")).toBeInTheDocument();
  });

  it("shows the no-results empty state when the search matches nothing", async () => {
    renderList();
    await screen.findByText("Jan Novák");

    fireEvent.change(screen.getByPlaceholderText("Hledat podle názvu nebo IČO…"), {
      target: { value: "zzz-no-such-customer" },
    });

    expect(await screen.findByText("Žádný odběratel neodpovídá hledání.")).toBeInTheDocument();
  });

  it("shows a disabled load-more button once every page is loaded", async () => {
    renderList();
    const button = await screen.findByRole("button", { name: "Žádní další" });
    expect(button).toBeDisabled();
  });

  it("mutes the name link and badges 'Archivováno' for an archived row", async () => {
    listOverride = archivedOverride();
    renderList();
    const link = await screen.findByRole("link", { name: "Zaniklá s.r.o." });
    expect(link.className).toContain("text-muted-foreground");
    expect(screen.getByText("Archivováno")).toBeInTheDocument();
  });
});
