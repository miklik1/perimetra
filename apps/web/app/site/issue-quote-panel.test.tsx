import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@repo/api";
import { ApiProvider } from "@repo/api/react";
import { cs } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";
import type { IssueQuoteInput } from "@repo/validators";

import { IssueQuotePanel, issueRejectionCode } from "./issue-quote-panel";

// The panel calls `useRouter()` (post-issue navigation) — mocked like
// app-shell.test.tsx so rendering it doesn't need a real app-router mount.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

// Behavior-lock for CAR-23: the ARES/VIES wiring moved into shared
// `useAresLookup`/`useViesLookup` hooks (registry-lookup.tsx), reused by the
// new `/customers` surface — this proves the issue panel's inline customer
// picker + create form still work UNCHANGED after that extraction.
const payload = {
  site: {},
  instances: [],
} as unknown as Pick<IssueQuoteInput, "site" | "instances">;

function renderPanel() {
  return render(
    <I18nProvider locale="cs" messages={cs}>
      <ApiProvider baseUrl="https://test.local/api">
        <IssueQuotePanel projectId="proj-1" payload={payload} />
      </ApiProvider>
    </I18nProvider>,
  );
}

describe("IssueQuotePanel — customer picker + inline create", () => {
  it("lists the seeded customers in the picker", async () => {
    renderPanel();
    expect(await screen.findByText("Bartek Vrata s.r.o.")).toBeInTheDocument();
  });

  it("toggles the inline create form and prefills name + DIČ from ARES", async () => {
    renderPanel();
    fireEvent.click(screen.getByText("+ Nový odběratel"));

    fireEvent.change(screen.getByPlaceholderText("IČO"), { target: { value: "27074358" } });
    fireEvent.click(screen.getByRole("button", { name: "Načíst z ARES" }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Název / jméno")).toHaveValue("Demo Stavby s.r.o.");
    });
    expect(screen.getByPlaceholderText("DIČ")).toHaveValue("CZ27074358");
  });

  it("shows the VIES badge once a well-formed DIČ is typed", async () => {
    renderPanel();
    fireEvent.click(screen.getByText("+ Nový odběratel"));
    fireEvent.change(screen.getByPlaceholderText("DIČ"), { target: { value: "CZ27074358" } });
    expect(await screen.findByText("DIČ ověřeno v systému VIES")).toBeInTheDocument();
  });

  it("creates the new customer and selects it in the picker", async () => {
    renderPanel();
    fireEvent.click(screen.getByText("+ Nový odběratel"));
    fireEvent.change(screen.getByPlaceholderText("Název / jméno"), {
      target: { value: "Testovací klient s.r.o." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Vytvořit" }));

    expect(await screen.findByText("Testovací klient s.r.o.")).toBeInTheDocument();
  });
});

/**
 * ADR 0126: the odběratel became MANDATORY at issue (the api 422s
 * `customer_required` without one). The panel must refuse the state BEFORE the
 * round trip — a rep should learn the rule from the form, not from a failed
 * issue — while the server guard remains the authority.
 */
describe("IssueQuotePanel — the buyer is mandatory (ADR 0126)", () => {
  it("offers no 'no customer' choice — only a disabled placeholder prompt", async () => {
    renderPanel();
    await screen.findByText("Bartek Vrata s.r.o.");

    // The old option ADVERTISED the one state the api refuses.
    expect(screen.queryByRole("option", { name: "Bez odběratele" })).not.toBeInTheDocument();
    // What replaced it is a prompt, not a selectable value.
    expect(screen.getByRole("option", { name: "— vyberte odběratele —" })).toBeDisabled();
  });

  it("disables Vydat nabídku and says why, before anything is sent", async () => {
    renderPanel();
    await screen.findByText("Bartek Vrata s.r.o.");

    expect(screen.getByRole("button", { name: "Vydat nabídku" })).toBeDisabled();
    // The reason is on screen, not implied by the greyed-out button…
    expect(screen.getByText(/Nabídku nelze vydat bez odběratele/)).toBeInTheDocument();
    // …and it is wired to the picker, so a screen-reader user hears it too.
    expect(screen.getByRole("combobox")).toHaveAccessibleDescription(
      /Nabídku nelze vydat bez odběratele/,
    );
  });

  it("enables Vydat nabídku once a buyer is picked, and drops the hint", async () => {
    renderPanel();
    const option = await screen.findByRole<HTMLOptionElement>("option", {
      name: "Bartek Vrata s.r.o.",
    });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: option.value } });

    expect(screen.getByRole("button", { name: "Vydat nabídku" })).toBeEnabled();
    expect(screen.queryByText(/Nabídku nelze vydat bez odběratele/)).not.toBeInTheDocument();
  });
});

/**
 * The typed 422 refusals the issue endpoint can answer with. Driven through the
 * recogniser rather than a rendered panel because `@repo/api-mocks` only ever
 * refuses `POST /v1/quotes` with its own generic `INVALID_INPUT` — there is no
 * mock path that produces these codes. This is the regression net for a backend
 * code being renamed out from under the panel's copy.
 */
describe("issueRejectionCode — the named 422 preconditions", () => {
  const apiError = (status: number, body: unknown) =>
    new ApiError({ kind: "http", status, message: "err", body });

  it.each([
    "customer_required",
    "legal_profile_required",
    "supplier_not_vat_payer",
    "margin_below_floor",
    "margin_floor_without_cost",
  ])("recognises %s", (code) => {
    expect(issueRejectionCode(apiError(422, { code }))).toBe(code);
  });

  it("does NOT claim site_invalid — that one is rendered as typed I5 issues", () => {
    expect(issueRejectionCode(apiError(422, { code: "site_invalid", issues: [] }))).toBeUndefined();
  });

  it("ignores an unknown code, a non-422 status, and a non-ApiError", () => {
    expect(issueRejectionCode(apiError(422, { code: "something_new" }))).toBeUndefined();
    // A 409 carrying a 422-ish code must not be re-labelled as a precondition.
    expect(issueRejectionCode(apiError(409, { code: "customer_required" }))).toBeUndefined();
    expect(issueRejectionCode(new Error("boom"))).toBeUndefined();
    expect(issueRejectionCode(null)).toBeUndefined();
  });
});
