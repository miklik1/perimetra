import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiProvider } from "@repo/api/react";
import { cs } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";

import { InvoicesList } from "./invoices-list";

// A minimal `infiniteQueryOptions`-shaped override, used ONLY by the empty/error
// tests (the `orders-list.test.tsx` pattern): swapping the `queryFn` is far less
// brittle than reaching into the shared MSW server (not exported by
// vitest.setup.ts) or spying on a source-file export. `null` (the default) falls
// through to the REAL `createInvoicesQueries`, so every other test still
// exercises the actual endpoint factory against the mocked `/v1/invoices` route.
type ListOverride = {
  queryKey: readonly unknown[];
  queryFn: () => Promise<{ items: never[]; nextCursor: null }>;
  initialPageParam: string;
  getNextPageParam: () => undefined;
};
let listOverride: ListOverride | null = null;

vi.mock("../../lib/invoices-queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/invoices-queries")>();
  return {
    ...actual,
    createInvoicesQueries: (client: Parameters<typeof actual.createInvoicesQueries>[0]) => {
      const real = actual.createInvoicesQueries(client);
      return { ...real, list: () => listOverride ?? real.list() };
    },
  };
});

function emptyOverride(): ListOverride {
  return {
    queryKey: ["invoices-test", "empty"],
    queryFn: async () => ({ items: [], nextCursor: null }),
    initialPageParam: "",
    getNextPageParam: () => undefined,
  };
}

function errorOverride(): ListOverride {
  return {
    queryKey: ["invoices-test", "error"],
    queryFn: async () => {
      throw new Error("boom");
    },
    initialPageParam: "",
    getNextPageParam: () => undefined,
  };
}

// MSW (vitest.setup.ts) serves the `invoices` mock group — 3 seeded invoices,
// reseeded per test: FV2026/0001 issued/unpaid, FV2026/0002 paid, FV2026/0003
// issued + superseded. Sorted id-descending, so 0003 renders first.
function renderList() {
  return render(
    <I18nProvider locale="cs" messages={cs}>
      <ApiProvider baseUrl="https://test.local/api">
        <InvoicesList />
      </ApiProvider>
    </I18nProvider>,
  );
}

afterEach(() => {
  listOverride = null;
});

describe("InvoicesList", () => {
  it("renders the seeded invoices with document numbers + status badges", async () => {
    renderList();
    expect(await screen.findByText("FV2026/0001")).toBeInTheDocument();
    expect(screen.getByText("FV2026/0002")).toBeInTheDocument();
    expect(screen.getByText("FV2026/0003")).toBeInTheDocument();
    // Invoice status badges in Czech (issued / paid).
    expect(screen.getAllByText("Vydáno").length).toBeGreaterThan(0);
    expect(screen.getByText("Zaplaceno")).toBeInTheDocument();
  });

  it("exposes an accessible table with the four columns in order", async () => {
    renderList();
    const table = await screen.findByRole("table", { name: "Seznam faktur" });
    const headers = within(table).getAllByRole("columnheader");
    expect(headers.map((h) => h.textContent)).toEqual([
      "Číslo dokladu",
      "Stav",
      "Splatnost",
      "Celkem",
    ]);
  });

  it("gives each row exactly ONE stretched link — the document number", async () => {
    renderList();
    const link = await screen.findByRole("link", { name: "FV2026/0001" });
    expect(link).toHaveAttribute("href", expect.stringContaining("/invoices/"));

    // The o-LIST contract (ADR 0121): one anchor, one tab stop per row. The
    // superseded marker beside the badge must stay inert markup.
    const row = screen.getByText("FV2026/0003").closest("tr");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getAllByRole("link")).toHaveLength(1);
  });

  it("renders the ROW total through formatMoney (cs-CZ currency)", async () => {
    renderList();
    const row = (await screen.findByText("FV2026/0001")).closest("tr");
    expect(row?.textContent).toMatch(/Kč/);
  });

  it("marks a superseded invoice beside its status badge", async () => {
    renderList();
    const row = (await screen.findByText("FV2026/0003")).closest("tr");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("Vydáno")).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText("Nahrazeno")).toBeInTheDocument();
    // …and only there — the other two rows carry no lineage marker.
    expect(screen.getAllByText("Nahrazeno")).toHaveLength(1);
  });

  it("shows a disabled load-more button once every page is loaded", async () => {
    renderList();
    const button = await screen.findByRole("button", { name: "Žádné další" });
    expect(button).toBeDisabled();
  });
});

describe("InvoicesList — empty and error states", () => {
  it("renders the empty state when there are no invoices", async () => {
    listOverride = emptyOverride();
    renderList();
    expect(await screen.findByText("Zatím žádné faktury.")).toBeInTheDocument();
    expect(screen.getByText("Faktura vzniká vystavením ze zakázky.")).toBeInTheDocument();
  });

  it("renders a live-region error on a failed load", async () => {
    listOverride = errorOverride();
    renderList();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
