import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { cs } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";

import { visibleNavEntries } from "../../lib/nav-registry";
import { MobileTopBar } from "./mobile-top-bar";

// `Link` wraps next/link; MobileTopBar takes `pathname` as a prop, but
// next/navigation must still resolve for the Link wrapper.
vi.mock("next/navigation", () => ({
  usePathname: () => "/orders",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

function renderBar(userLabel?: string) {
  // admin + platform operator → footer group = [platform, settings].
  const entries = visibleNavEntries({ role: "admin", isPlatformAdmin: true });
  return render(
    <I18nProvider locale="cs" messages={cs}>
      <MobileTopBar entries={entries} pathname="/orders" userLabel={userLabel} />
    </I18nProvider>,
  );
}

describe("MobileTopBar footer menu (the sole mobile escape to Nastavení/Platforma, §4.4)", () => {
  it("shows the account initial on the avatar trigger", () => {
    renderBar("Admin User");
    expect(screen.getByRole("button", { name: "Další volby" })).toHaveTextContent("A");
  });

  it("falls back to a neutral glyph without an account label", () => {
    renderBar(undefined);
    expect(screen.getByRole("button", { name: "Další volby" })).toHaveTextContent("•");
  });

  it("opens the footer menu and closes it on selection (onNavigate → setOpen(false))", () => {
    renderBar("Admin User");
    // Closed: the footer links are portalled only when open.
    expect(screen.queryByRole("link", { name: "Nastavení" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Další volby" }));
    expect(screen.getByRole("link", { name: "Nastavení" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Platforma" })).toBeInTheDocument();

    // Selecting a footer item closes the popover.
    fireEvent.click(screen.getByRole("link", { name: "Nastavení" }));
    expect(screen.queryByRole("link", { name: "Nastavení" })).toBeNull();
  });
});
