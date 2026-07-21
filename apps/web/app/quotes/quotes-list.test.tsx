import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ApiProvider } from "@repo/api/react";
import { cs } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";
import { formatDate } from "@repo/utils";

import { QuotesList } from "./quotes-list";

// MSW (vitest.setup.ts) serves the `quotes` mock group — 3 seeded quotes
// (standard / §92e / accepted), reseeded per test.
function renderList() {
  return render(
    <I18nProvider locale="cs" messages={cs}>
      <ApiProvider baseUrl="https://test.local/api">
        <QuotesList />
      </ApiProvider>
    </I18nProvider>,
  );
}

describe("QuotesList", () => {
  it("renders the seeded quotes with document numbers + status badges", async () => {
    renderList();
    expect(await screen.findByText("2026/0001")).toBeInTheDocument();
    expect(screen.getByText("2026/0003")).toBeInTheDocument();
    // Status badges in Czech (issued / accepted).
    expect(screen.getAllByText("Vydáno").length).toBeGreaterThan(0);
    expect(screen.getByText("Přijato")).toBeInTheDocument();
  });

  it("formats the total as CZK currency", async () => {
    renderList();
    // 129891.5 → "129 891,50 Kč" (cs); every priced seeded quote shows it, so
    // >0 matches (the price-blind seed shows none).
    const totals = await screen.findAllByText(
      (text) => text.includes("129") && text.includes("891"),
    );
    expect(totals.length).toBeGreaterThan(0);
  });

  it("exposes an accessible table with one stretched link per row", async () => {
    renderList();
    const table = await screen.findByRole("table", { name: "Seznam nabídek" });
    expect(table).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "2026/0001" });
    expect(link).toHaveAttribute("href", expect.stringContaining("/quotes/"));
  });

  it("renders a formatted validity date, or a dash when none", async () => {
    renderList();
    // The price-blind seed (2026/0004) carries validUntil 2026-08-15T00:00:00Z
    // — computed via the same `formatDate` the component calls, so this stays
    // timezone-agnostic rather than asserting a hardcoded locale string.
    await screen.findByText("2026/0004");
    const expected = formatDate("2026-08-15T00:00:00.000Z", { dateStyle: "medium" }, "cs");
    expect(screen.getByText(expected)).toBeInTheDocument();
    // The other seeded quotes have no validUntil — rendered as a dash.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("never renders money for the price-blind (workshop-stripped) row", async () => {
    renderList();
    const row = (await screen.findByText("2026/0004")).closest("tr");
    expect(row).not.toBeNull();
    expect(row?.textContent).not.toMatch(/Kč/);
  });

  it("shows a disabled load-more button once every page is loaded", async () => {
    renderList();
    const button = await screen.findByRole("button", { name: "Žádné další" });
    expect(button).toBeDisabled();
  });
});
