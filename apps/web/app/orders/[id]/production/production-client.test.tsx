import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { ApiProvider } from "@repo/api/react";
import { cs } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";
import { type OrderDetail, type QuoteProduction } from "@repo/validators";

import { OrderProductionClient } from "./production-client";

// The wrapper reskin is chrome-only (breadcrumb + frame) — this test proves
// just that chrome, not the shared `ProductionView` (covered by
// `../../../quotes/[id]/production/production-view.test.tsx`, which this
// route reuses verbatim). AuthGuard/router/query plumbing is stubbed rather
// than driven through a real session + MSW round trip, per the detail plan's
// "if heavy, stub it" allowance.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@repo/auth/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/auth/react")>();
  return {
    ...actual,
    AuthGuard: ({ children }: { children: ReactNode }) => <>{children}</>,
  };
});

const PRODUCTION: QuoteProduction = {
  id: "00000000-0000-7000-8000-000000000009",
  documentNumber: "2026/0007",
  status: "issued",
  createdAt: "2026-07-01T00:00:00.000Z",
  instances: [{ instanceId: "gate", releaseId: "sliding-gate@1" }],
  bom: [],
  cutList: { components: [] },
  cutOptions: { kerfMm: 3 },
  drawings: { site: { instances: [], connections: [], terrain: [] }, instances: {} },
};

// The breadcrumb leaf is the ORDER number (from the thin order read), not the
// production snapshot's quote-tier documentNumber ("2026/0007").
const ORDER: OrderDetail = {
  id: "00000000-0000-7000-8000-000000000009",
  quoteId: "00000000-0000-7000-8000-00000000000a",
  orderNumber: "Z2026/0002",
  status: "in_production",
  cancelReason: null,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

vi.mock("@repo/api/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/api/react")>();
  return {
    ...actual,
    // Two reads back this surface: the order detail (breadcrumb) and the
    // production projection (body) — routed by cache-key tier.
    useQuery: (options: { queryKey: readonly unknown[] }) =>
      options.queryKey.includes("detail")
        ? { data: ORDER, error: null }
        : { data: PRODUCTION, error: null },
  };
});

function renderClient() {
  return render(
    <I18nProvider locale="cs" messages={cs}>
      <ApiProvider baseUrl="https://test.local/api">
        <OrderProductionClient id="00000000-0000-7000-8000-000000000009" />
      </ApiProvider>
    </I18nProvider>,
  );
}

describe("OrderProductionClient — the price-blind detail chrome", () => {
  it("renders a registry-derived breadcrumb back to Zakázky plus the order-number leaf", () => {
    renderClient();
    const nav = screen.getByRole("navigation", { name: "Zakázky" });
    const back = within(nav).getByRole("link", { name: "Zakázky" });
    expect(back).toHaveAttribute("href", "/orders");
    // The leaf is the ORDER number the user clicked, not the underlying quote's
    // evidenční číslo ("2026/0007") the production snapshot carries.
    expect(within(nav).getByText("Z2026/0002")).toBeInTheDocument();
    expect(within(nav).queryByText("2026/0007")).not.toBeInTheDocument();
  });

  it("never renders a money value — the production route is price-blind", () => {
    const { container } = renderClient();
    expect(container.textContent).not.toMatch(/Kč/);
  });
});
