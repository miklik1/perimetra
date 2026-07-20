import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { cs } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";

import { ContextBar } from "./context-bar";

/**
 * The bar's contract is mostly about what it must NOT claim: `/configurator` is
 * bound to no project and no quote, so a quote number / project name / saved
 * state / back link would be a fabricated record on screen. The rest guards the
 * computing indicator's live-region semantics.
 */
function renderBar(props?: Partial<React.ComponentProps<typeof ContextBar>>) {
  return render(
    <I18nProvider locale="cs" messages={cs}>
      <ContextBar productLabel="Posuvná brána" catalogVersion={3} computing={false} {...props} />
    </I18nProvider>,
  );
}

describe("ContextBar", () => {
  it("shows the wordmark, the product and the real catalog version", () => {
    renderBar();
    expect(screen.getByText("Perimetra")).toBeInTheDocument();
    expect(screen.getByText("Posuvná brána")).toBeInTheDocument();
    expect(screen.getByText("katalog 3")).toBeInTheDocument();
  });

  it("is a named banner landmark", () => {
    renderBar();
    expect(screen.getByRole("banner", { name: "Konfigurátor" })).toBeInTheDocument();
  });

  it("claims no project/quote binding it does not have", () => {
    renderBar();
    // saved-state, quote-preview and back-to-project affordances from the canvas
    expect(screen.queryByText("Uloženo")).not.toBeInTheDocument();
    expect(screen.queryByText("Neuloženo")).not.toBeInTheDocument();
    expect(screen.queryByText("Náhled nabídky")).not.toBeInTheDocument();
    expect(screen.queryByText("Zpět na projekt")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    // no fabricated quote number (N-YYYY-NNNN) or project name
    expect(screen.queryByText(/N-\d{4}-\d{4}/)).not.toBeInTheDocument();
  });

  it("announces the derive politely only while computing", () => {
    const { rerender } = renderBar();
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toBeEmptyDOMElement();

    rerender(
      <I18nProvider locale="cs" messages={cs}>
        <ContextBar productLabel="Posuvná brána" catalogVersion={3} computing />
      </I18nProvider>,
    );
    expect(within(screen.getByRole("status")).getByText("Přepočítávám…")).toBeInTheDocument();
  });

  it("keeps the live region mounted so the slot never reflows", () => {
    // the ghost reserves the indicator's box in both states, and is hidden from
    // assistive tech so it never double-announces
    const { container, rerender } = renderBar();
    const ghost = container.querySelector('[data-slot="context-bar-computing"] [aria-hidden]');
    expect(ghost).toHaveClass("invisible");
    expect(ghost).toHaveTextContent("Přepočítávám…");
    expect(screen.getAllByText("Přepočítávám…")).toHaveLength(1);

    rerender(
      <I18nProvider locale="cs" messages={cs}>
        <ContextBar productLabel="Posuvná brána" catalogVersion={3} computing />
      </I18nProvider>,
    );
    expect(screen.getAllByText("Přepočítávám…")).toHaveLength(2);
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("renders the trailing slot after the indicator", () => {
    renderBar({ children: <button type="button">Sdílet</button> });
    const trailing = screen
      .getByRole("banner")
      .querySelector('[data-slot="context-bar-trailing"]') as HTMLElement;
    expect(within(trailing).getByRole("button", { name: "Sdílet" })).toBeInTheDocument();
  });

  it("throws when a part escapes its root", () => {
    expect(() => render(<ContextBar.Wordmark />)).toThrow(/must be rendered inside <ContextBar>/);
  });
});
