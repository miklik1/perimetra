import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ApiProvider } from "@repo/api/react";
import { cs } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";
import type { IssueQuoteInput } from "@repo/validators";

import { IssueQuotePanel } from "./issue-quote-panel";

// The panel calls `useRouter()` (post-issue navigation) — mocked like
// nav-shell.test.tsx so rendering it doesn't need a real app-router mount.
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
