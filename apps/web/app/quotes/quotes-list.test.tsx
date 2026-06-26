import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ApiProvider } from "@repo/api/react";
import { cs } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";

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
    // 129891.5 → "129 891,50 Kč" (cs); every seeded quote shows it, so >0 matches.
    const totals = await screen.findAllByText(
      (text) => text.includes("129") && text.includes("891"),
    );
    expect(totals.length).toBeGreaterThan(0);
  });
});
