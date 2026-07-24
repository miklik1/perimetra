import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@repo/api";
import { ApiProvider } from "@repo/api/react";
import { cs } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";
import type { OrderDetail } from "@repo/validators";

import { IssueInvoicePanel, issueRejectionCode } from "./issue-invoice-panel";

// The panel calls `useRouter()` (post-issue navigation) — mocked like
// app-shell.test.tsx so rendering it doesn't need a real app-router mount.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

// The shipped `@repo/api-mocks` orders group seeds only `confirmed` +
// `in_production` rows, and `handlers/orders.ts` belongs to another surface — so
// the cancelled-order filter is proved by overriding the LIST query rather than
// by widening a shared fixture. Same `queryFn`-swap lever as
// `orders-list.test.tsx`; `null` falls through to the REAL factory against the
// mocked `/v1/orders`, so every other test still exercises the real path.
type OrdersPage = { items: OrderDetail[]; nextCursor: string | null };
type OrdersListOverride = {
  queryKey: readonly unknown[];
  queryFn: (ctx: { pageParam: string }) => Promise<OrdersPage>;
  initialPageParam: string;
  getNextPageParam: (last: OrdersPage) => string | undefined;
};
let ordersOverride: OrdersListOverride | null = null;

vi.mock("../../lib/orders-queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/orders-queries")>();
  return {
    ...actual,
    createOrdersQueries: (client: Parameters<typeof actual.createOrdersQueries>[0]) => {
      const real = actual.createOrdersQueries(client);
      return { ...real, list: () => ordersOverride ?? real.list() };
    },
  };
});

function order(over: Partial<OrderDetail>): OrderDetail {
  return {
    id: "01920000-0000-7000-8000-000000000001",
    quoteId: "01910000-0000-7000-8000-000000000001",
    orderNumber: "Z2026/0001",
    status: "confirmed",
    cancelReason: null,
    createdAt: "2026-07-01T08:00:00.000Z",
    updatedAt: "2026-07-01T08:00:00.000Z",
    ...over,
  };
}

function withCancelledOrder(): OrdersListOverride {
  return {
    queryKey: ["orders-test", "with-cancelled"],
    queryFn: async () => ({
      items: [
        order({}),
        order({
          id: "01920000-0000-7000-8000-000000000009",
          orderNumber: "Z2026/0009",
          status: "cancelled",
          cancelReason: "zrušeno zákazníkem",
        }),
      ],
      nextCursor: null,
    }),
    initialPageParam: "",
    getNextPageParam: () => undefined,
  };
}

/** Two keyset pages: the older, invoiceable order sits on the SECOND one. */
function withSecondPage(): OrdersListOverride {
  return {
    queryKey: ["orders-test", "paged"],
    queryFn: async ({ pageParam }) =>
      pageParam
        ? {
            items: [
              order({ id: "01920000-0000-7000-8000-000000000021", orderNumber: "Z2026/0021" }),
            ],
            nextCursor: null,
          }
        : { items: [order({})], nextCursor: "cursor-2" },
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  };
}

function failingOrders(): OrdersListOverride {
  return {
    queryKey: ["orders-test", "error"],
    queryFn: async () => {
      throw new Error("boom");
    },
    initialPageParam: "",
    getNextPageParam: () => undefined,
  };
}

function noOrders(): OrdersListOverride {
  return {
    queryKey: ["orders-test", "empty"],
    queryFn: async () => ({ items: [], nextCursor: null }),
    initialPageParam: "",
    getNextPageParam: () => undefined,
  };
}

function renderPanel() {
  return render(
    <I18nProvider locale="cs" messages={cs}>
      <ApiProvider baseUrl="https://test.local/api">
        <IssueInvoicePanel onClose={vi.fn()} />
      </ApiProvider>
    </I18nProvider>,
  );
}

afterEach(() => {
  ordersOverride = null;
});

/**
 * ADR 0126's governing rule inverts on a tax document: on a VIEW you may honestly
 * subtract, but on an ISSUE the server must REFUSE before a gap-free number is
 * burned. The panel's job is to say the refusal BEFORE the round trip — and to
 * never advertise a state the api will reject.
 */
describe("IssueInvoicePanel — the order is mandatory", () => {
  it("offers no 'no order' choice — only a disabled placeholder prompt", async () => {
    renderPanel();
    await screen.findByRole("option", { name: "Z2026/0001" });
    expect(screen.getByRole("option", { name: "— vyberte zakázku —" })).toBeDisabled();
  });

  it("disables Vystavit fakturu and says why, before anything is sent", async () => {
    renderPanel();
    await screen.findByRole("option", { name: "Z2026/0001" });

    expect(screen.getByRole("button", { name: "Vystavit fakturu" })).toBeDisabled();
    // The reason is on screen, not implied by the greyed-out button…
    expect(
      screen.getByText("Fakturu nelze vystavit bez zakázky — vyberte ji výše."),
    ).toBeInTheDocument();
    // …and it is wired to the picker, so a screen-reader user hears it too.
    expect(screen.getByRole("combobox")).toHaveAccessibleDescription(
      /Fakturu nelze vystavit bez zakázky/,
    );
  });

  it("never offers a cancelled order — the api's own order_cancelled guard, mirrored", async () => {
    ordersOverride = withCancelledOrder();
    renderPanel();

    expect(await screen.findByRole("option", { name: "Z2026/0001" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Z2026/0009" })).not.toBeInTheDocument();
  });
});

/**
 * "Žádná zakázka k fakturaci." is a factual claim about the org's data. It may
 * not stand in for "still loading" or "the request failed" (ADR 0126 contract
 * honesty), and the picker may not silently omit orders past the first keyset
 * page — a `<select>` has no load-more, so an omitted order is uninvoiceable
 * with nothing on screen saying so.
 */
describe("IssueInvoicePanel — the order source answers honestly", () => {
  it("offers orders past the first keyset page — the cursor is exhausted", async () => {
    ordersOverride = withSecondPage();
    renderPanel();

    expect(await screen.findByRole("option", { name: "Z2026/0021" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Z2026/0001" })).toBeInTheDocument();
  });

  it("announces a failed orders read instead of claiming there is nothing to invoice", async () => {
    ordersOverride = failingOrders();
    renderPanel();

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("Žádná zakázka k fakturaci.")).not.toBeInTheDocument();
    // …and the hint must not point at a picker that is not on screen.
    expect(
      screen.queryByText("Fakturu nelze vystavit bez zakázky — vyberte ji výše."),
    ).not.toBeInTheDocument();
  });

  it("claims 'no order to invoice' only once the read has actually answered empty", async () => {
    ordersOverride = noOrders();
    renderPanel();

    expect(await screen.findByText("Žádná zakázka k fakturaci.")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Fakturu nelze vystavit bez zakázky — vyberte ji výše."),
    ).not.toBeInTheDocument();
  });
});

/**
 * The typed refusals the issue endpoint can answer with. Driven through the
 * recogniser rather than a rendered panel because `@repo/api-mocks` only ever
 * refuses `POST /v1/invoices` with its own generic `INVALID_INPUT` — there is no
 * mock path that produces these codes. This is the regression net for a backend
 * code being renamed out from under the panel's copy.
 */
describe("issueRejectionCode — the named issue refusals", () => {
  const apiError = (status: number, body: unknown) =>
    new ApiError({ kind: "http", status, message: "err", body });

  it.each([
    "legal_profile_required",
    "legal_profile_incomplete",
    "iban_required",
    "customer_required",
    "customer_anonymized",
    "supplier_not_vat_payer",
    "section29_incomplete",
  ])("recognises the 422 precondition %s", (code) => {
    expect(issueRejectionCode(apiError(422, { code }))).toBe(code);
  });

  it.each(["invoice_exists", "order_cancelled"])("recognises the 409 conflict %s", (code) => {
    expect(issueRejectionCode(apiError(409, { code }))).toBe(code);
  });

  it("ignores an unknown code on either status, a 500, and a non-ApiError", () => {
    expect(issueRejectionCode(apiError(422, { code: "something_new" }))).toBeUndefined();
    expect(issueRejectionCode(apiError(409, { code: "something_new" }))).toBeUndefined();
    // A 500 is un-actionable: it names nothing the rep can fix, so it must fall
    // through to the generic mapped toast rather than borrow a precondition's copy.
    expect(issueRejectionCode(apiError(500, { code: "customer_required" }))).toBeUndefined();
    expect(issueRejectionCode(apiError(422, null))).toBeUndefined();
    expect(issueRejectionCode(new Error("boom"))).toBeUndefined();
    expect(issueRejectionCode(null)).toBeUndefined();
  });
});
