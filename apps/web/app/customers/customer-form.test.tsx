import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ApiProvider } from "@repo/api/react";
import { cs } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";

import { CustomerForm } from "./customer-form";

// MSW (vitest.setup.ts) serves `lookups` (deterministic ARES/VIES stand-ins,
// ADR 0090) + `customers` mock groups.
function renderForm(onSaved = vi.fn()) {
  return render(
    <I18nProvider locale="cs" messages={cs}>
      <ApiProvider baseUrl="https://test.local/api">
        <CustomerForm onSaved={onSaved} />
      </ApiProvider>
    </I18nProvider>,
  );
}

describe("CustomerForm — ARES prefill + VIES badge wiring (CAR-23)", () => {
  it("prefills name/DIČ/address from a `found` ARES lookup", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("IČO"), { target: { value: "27074358" } });
    fireEvent.click(screen.getByRole("button", { name: "Načíst z ARES" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Název / jméno")).toHaveValue("Demo Stavby s.r.o.");
    });
    expect(screen.getByLabelText("DIČ")).toHaveValue("CZ27074358");
    expect(screen.getByLabelText("Ulice a číslo")).toHaveValue("Dlouhá 1");
    expect(screen.getByLabelText("Město")).toHaveValue("Praha");
  });

  it("the ARES button stays disabled until the IČO is well-formed (mod-11 checksum)", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("IČO"), { target: { value: "12345678" } }); // bad checksum
    expect(screen.getByRole("button", { name: "Načíst z ARES" })).toBeDisabled();
  });

  it("shows a valid VIES badge for a well-formed DIČ (mock: valid unless it ends in 0)", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("DIČ"), { target: { value: "CZ27074358" } });
    expect(await screen.findByText("DIČ ověřeno v systému VIES")).toBeInTheDocument();
  });

  it("shows an invalid VIES badge for a DIČ ending in 0 (mock convention)", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("DIČ"), { target: { value: "CZ270743580" } });
    expect(await screen.findByText("DIČ není platné (VIES)")).toBeInTheDocument();
  });

  it("creates a customer on submit and calls onSaved with the created row", async () => {
    const onSaved = vi.fn();
    renderForm(onSaved);
    fireEvent.change(screen.getByLabelText("Název / jméno"), {
      target: { value: "Nový zákazník s.r.o." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Vytvořit odběratele" }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onSaved.mock.calls[0]?.[0]).toMatchObject({ name: "Nový zákazník s.r.o." });
  });
});
