import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { en } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";

import { themeStore } from "../../lib/theme";
import { ThemeToggle } from "./theme-toggle";

function renderToggle() {
  return render(
    <I18nProvider locale="en" messages={en}>
      <h2 id="h">Theme</h2>
      <ThemeToggle labelledBy="h" />
    </I18nProvider>,
  );
}

describe("ThemeToggle (ADR 0140)", () => {
  beforeEach(() => {
    localStorage.clear();
    themeStore.getState().setTheme("system");
    localStorage.clear();
  });
  afterEach(() => localStorage.clear());

  it("offers all three preferences, including system", () => {
    renderToggle();
    for (const name of ["light", "dark", "system"]) {
      expect(screen.getByRole("button", { name, pressed: undefined })).toBeTruthy();
    }
  });

  it("persists the choice to the key the no-FOUC script reads", () => {
    renderToggle();

    fireEvent.click(screen.getByRole("button", { name: "dark" }));

    // The inline script in app/layout.tsx reads localStorage["theme"] and forces
    // dark only on the exact string "dark" — so the stored value has to be the
    // raw preference, not JSON, or first paint silently disagrees with the store.
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(themeStore.getState().theme).toBe("dark");
  });

  it("can return to system, which the store's two-way toggle() cannot express", () => {
    renderToggle();

    fireEvent.click(screen.getByRole("button", { name: "dark" }));
    fireEvent.click(screen.getByRole("button", { name: "system" }));

    expect(themeStore.getState().theme).toBe("system");
    expect(localStorage.getItem("theme")).toBe("system");
  });

  it("marks exactly one segment pressed, and it is the stored preference", () => {
    renderToggle();

    fireEvent.click(screen.getByRole("button", { name: "light" }));

    expect(screen.getByRole("button", { name: "light" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "dark" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "system" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });
});
