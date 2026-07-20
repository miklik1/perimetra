import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Alert } from "./alert";

describe("Alert", () => {
  it("announces urgently for destructive/warning and politely for info/success", () => {
    const { rerender } = render(
      <Alert tone="warning">
        <Alert.Title>Ceník není aktivní</Alert.Title>
      </Alert>,
    );
    expect(screen.getByRole("alert")).toHaveAttribute("data-tone", "warning");

    rerender(
      <Alert tone="destructive">
        <Alert.Title>Chyba</Alert.Title>
      </Alert>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();

    rerender(
      <Alert tone="success">
        <Alert.Title>Hotovo</Alert.Title>
      </Alert>,
    );
    expect(screen.getByRole("status")).toHaveAttribute("data-tone", "success");

    rerender(
      <Alert tone="info">
        <Alert.Title>Informace</Alert.Title>
      </Alert>,
    );
    expect(screen.getByRole("status")).toHaveAttribute("data-tone", "info");
  });

  it("defaults to the info tone when none is given", () => {
    render(
      <Alert>
        <Alert.Title>Informace</Alert.Title>
      </Alert>,
    );
    expect(screen.getByRole("status")).toHaveClass("bg-info-subtle");
  });

  it("exposes the title as a heading so a persistent notice is findable", () => {
    render(
      <Alert tone="warning">
        <Alert.Title>Ceník není aktivní</Alert.Title>
        <Alert.Description>Bez aktivního ceníku nelze zobrazit ceny.</Alert.Description>
      </Alert>,
    );
    expect(screen.getByRole("heading", { name: "Ceník není aktivní" })).toBeInTheDocument();
    expect(screen.getByText("Bez aktivního ceníku nelze zobrazit ceny.")).toHaveClass(
      "text-muted-foreground",
    );
  });

  it("picks the tone-appropriate glyph and keeps it decorative", () => {
    const { rerender } = render(
      <Alert tone="warning">
        <Alert.Icon />
      </Alert>,
    );
    const icon = screen.getByRole("alert").querySelector("[data-slot='alert-icon']");
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon?.querySelector("svg")).toHaveAttribute("data-icon", "warn");
    expect(screen.queryByRole("img")).toBeNull();

    rerender(
      <Alert tone="success">
        <Alert.Icon />
      </Alert>,
    );
    expect(
      screen.getByRole("status").querySelector("[data-slot='alert-icon'] svg"),
    ).toHaveAttribute("data-icon", "check");
  });

  it("lets children override the default glyph", () => {
    render(
      <Alert tone="warning">
        <Alert.Icon>
          <svg data-icon="lock" />
        </Alert.Icon>
      </Alert>,
    );
    const icon = screen.getByRole("alert").querySelector("[data-slot='alert-icon'] svg");
    expect(icon).toHaveAttribute("data-icon", "lock");
  });

  it("renders the action slot's control and forwards its interaction", () => {
    const onClick = vi.fn();
    render(
      <Alert tone="warning">
        <Alert.Title>Ceník není aktivní</Alert.Title>
        <Alert.Action>
          <button type="button" onClick={onClick}>
            Nastavit ceník
          </button>
        </Alert.Action>
      </Alert>,
    );
    const button = screen.getByRole("button", { name: "Nastavit ceník" });
    button.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it.each(["info", "success", "warning", "destructive"] as const)(
    "keeps the %s title on text-foreground, never the tone ink (WCAG AA)",
    (tone) => {
      // The canvas colours this line with the solid tone. Measured on the real
      // tokens that is 2.02:1 (warning), 2.91:1 (success) and 3.14:1 (info) in
      // LIGHT mode against a 4.5:1 requirement — the solid status tokens are
      // tuned to carry white text, not to sit on their own -subtle fill.
      // text-foreground measures 12.2-15.8:1 in both themes.
      render(
        <Alert tone={tone}>
          <Alert.Title>Ceník není aktivní</Alert.Title>
        </Alert>,
      );

      const title = screen.getByRole("heading", { name: "Ceník není aktivní" });
      expect(title).toHaveClass("text-foreground");
      expect(title.className).not.toMatch(/text-(info|success|warning|destructive)\b/);
    },
  );

  it("throws a clear error when a part is rendered outside <Alert>", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Alert.Title>Ceník není aktivní</Alert.Title>)).toThrow(
      "<Alert.Title> must be rendered inside <Alert>.",
    );
    expect(() => render(<Alert.Icon />)).toThrow("<Alert.Icon> must be rendered inside <Alert>.");
    spy.mockRestore();
  });
});
