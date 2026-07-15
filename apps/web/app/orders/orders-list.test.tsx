import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ApiProvider } from "@repo/api/react";
import { cs } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";

import { OrdersList } from "./orders-list";

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
});
