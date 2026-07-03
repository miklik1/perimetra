import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ApiProvider } from "@repo/api/react";
import { cs } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";

import { CustomersList } from "./customers-list";

// MSW (vitest.setup.ts) serves the `customers` mock group — 2 seeded rows
// ("Bartek Vrata s.r.o." ico 27074358, "Jan Novák"), reseeded per test.
function renderList() {
  return render(
    <I18nProvider locale="cs" messages={cs}>
      <ApiProvider baseUrl="https://test.local/api">
        <CustomersList />
      </ApiProvider>
    </I18nProvider>,
  );
}

describe("CustomersList", () => {
  it("renders the seeded customers", async () => {
    renderList();
    expect(await screen.findByText("Bartek Vrata s.r.o.")).toBeInTheDocument();
    expect(screen.getByText("Jan Novák")).toBeInTheDocument();
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

  it("shows the no-results notice when the search matches nothing", async () => {
    renderList();
    await screen.findByText("Jan Novák");

    fireEvent.change(screen.getByPlaceholderText("Hledat podle názvu nebo IČO…"), {
      target: { value: "zzz-no-such-customer" },
    });

    expect(await screen.findByText("Žádný odběratel neodpovídá hledání.")).toBeInTheDocument();
  });
});
