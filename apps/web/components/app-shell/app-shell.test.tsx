import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { cs } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";

import { AppShell } from "./app-shell";

// `@repo/navigation`'s web binding re-exports next/navigation's `usePathname`
// and wraps `next/link` — mocking `next/navigation` covers both.
const { usePathnameMock } = vi.hoisted(() => ({ usePathnameMock: vi.fn(() => "/orders") }));
vi.mock("next/navigation", () => ({
  usePathname: usePathnameMock,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const { useAuthMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(() => ({ isAuthenticated: true, sessionValidated: true, user: null })),
}));
vi.mock("@repo/auth/react", () => ({ useAuth: useAuthMock }));

const { useRoleMock, usePlatformAdminMock } = vi.hoisted(() => ({
  useRoleMock: vi.fn(() => "admin" as string | null),
  usePlatformAdminMock: vi.fn(() => false),
}));
vi.mock("../../lib/use-role", () => ({
  useRole: useRoleMock,
  usePlatformAdmin: usePlatformAdminMock,
}));

function renderShell(pathname = "/orders") {
  usePathnameMock.mockReturnValue(pathname);
  return render(
    <I18nProvider locale="cs" messages={cs}>
      <AppShell>
        <div>PAGE CONTENT</div>
      </AppShell>
    </I18nProvider>,
  );
}

/** The CSS-toggled renderings are all in the DOM under test (jsdom applies no
 *  media queries), so scope every assertion to the rail under test. */
const sideRail = () => within(screen.getByTestId("app-side-rail"));
const iconRail = () => within(screen.getByTestId("app-icon-rail"));
const tabBar = () => within(screen.getByTestId("app-tab-bar"));

describe("AppShell — chrome suppression", () => {
  it("renders children BARE (no frame) when unauthenticated", () => {
    useAuthMock.mockReturnValue({ isAuthenticated: false, sessionValidated: true, user: null });
    renderShell("/orders");
    expect(screen.getByText("PAGE CONTENT")).toBeInTheDocument();
    expect(screen.queryByTestId("app-side-rail")).toBeNull();
    useAuthMock.mockReturnValue({ isAuthenticated: true, sessionValidated: true, user: null });
  });

  it("renders children bare on a public route even when authenticated", () => {
    renderShell("/login");
    expect(screen.getByText("PAGE CONTENT")).toBeInTheDocument();
    expect(screen.queryByTestId("app-side-rail")).toBeNull();

    renderShell("/nabidka/tok123");
    expect(screen.queryByTestId("app-side-rail")).toBeNull();
  });

  it("renders children bare on the /traveler PRINT routes (the §4.2 chrome-on-print bug)", () => {
    renderShell("/quotes/q1/production/traveler");
    expect(screen.getByText("PAGE CONTENT")).toBeInTheDocument();
    expect(screen.queryByTestId("app-side-rail")).toBeNull();

    renderShell("/orders/o1/production/traveler");
    expect(screen.queryByTestId("app-side-rail")).toBeNull();
  });
});

describe("AppShell — three renderings over one registry", () => {
  it("frames an authenticated surface with all three density rails + the page", () => {
    renderShell("/orders");
    expect(screen.getByText("PAGE CONTENT")).toBeInTheDocument();
    expect(screen.getByTestId("app-side-rail")).toBeInTheDocument();
    expect(screen.getByTestId("app-icon-rail")).toBeInTheDocument();
    expect(screen.getByTestId("app-mobile-topbar")).toBeInTheDocument();
    expect(screen.getByTestId("app-tab-bar")).toBeInTheDocument();
  });

  it("collapses by CSS breakpoint — each rendering carries its exact display-toggle classes (§4.4)", () => {
    // jsdom applies no media queries, so all four are always in the DOM; this
    // pins the class strings that ARE the "one rule, three renderings" mechanism,
    // so a breakpoint typo (e.g. two rails at one width, or none) fails here.
    renderShell("/orders");
    expect(screen.getByTestId("app-side-rail")).toHaveClass("hidden", "xl:flex");
    expect(screen.getByTestId("app-side-rail")).not.toHaveClass("md:flex");
    expect(screen.getByTestId("app-icon-rail")).toHaveClass("hidden", "md:flex", "xl:hidden");
    expect(screen.getByTestId("app-mobile-topbar")).toHaveClass("flex", "md:hidden");
    expect(screen.getByTestId("app-tab-bar")).toHaveClass("flex", "md:hidden");
  });

  it("wraps the page in a role-neutral slot — exactly one <main> landmark per route", () => {
    usePathnameMock.mockReturnValue("/orders");
    useAuthMock.mockReturnValue({ isAuthenticated: true, sessionValidated: true, user: null });
    useRoleMock.mockReturnValue("admin");
    render(
      <I18nProvider locale="cs" messages={cs}>
        <AppShell>
          <main>PAGE OWNS ITS MAIN</main>
        </AppShell>
      </I18nProvider>,
    );
    // The shell's content slot is a <div>, so the page's own <main> is the sole
    // main landmark — a wrapping <main> would nest two.
    expect(screen.getAllByRole("main")).toHaveLength(1);
  });

  it("mirrors membership + active state in the tablet icon rail (incl. the footer group)", () => {
    useRoleMock.mockReturnValue("admin");
    renderShell("/orders");
    const rail = iconRail();
    expect(rail.getByRole("link", { name: "Přehled" })).toBeInTheDocument();
    expect(rail.getByRole("link", { name: "Zakázky" })).toHaveAttribute("aria-current", "page");
    expect(rail.getByRole("link", { name: "Nastavení" })).toBeInTheDocument();
  });

  it("puts ONLY the main group in the mobile tab bar (footer is never a tab, §4.4), active-marked", () => {
    useRoleMock.mockReturnValue("admin");
    usePlatformAdminMock.mockReturnValue(true);
    renderShell("/orders/abc/production");
    const bar = tabBar();
    expect(bar.getByRole("link", { name: "Přehled" })).toBeInTheDocument();
    expect(bar.getByRole("link", { name: "Zakázky" })).toHaveAttribute("aria-current", "page");
    expect(bar.queryByRole("link", { name: "Nastavení" })).toBeNull();
    expect(bar.queryByRole("link", { name: "Platforma" })).toBeNull();
    usePlatformAdminMock.mockReturnValue(false);
  });

  it("shows an admin the main surfaces + the footer group in the side rail", () => {
    useRoleMock.mockReturnValue("admin");
    usePlatformAdminMock.mockReturnValue(false);
    renderShell("/orders");
    const rail = sideRail();
    expect(rail.getByRole("link", { name: "Přehled" })).toBeInTheDocument();
    expect(rail.getByRole("link", { name: "Katalog" })).toBeInTheDocument();
    expect(rail.getByRole("link", { name: "Nabídky" })).toBeInTheDocument();
    expect(rail.getByRole("link", { name: "Nastavení" })).toBeInTheDocument();
    expect(rail.queryByRole("link", { name: "Platforma" })).toBeNull();
  });

  it("marks the active section via aria-current, prefix-matched", () => {
    useRoleMock.mockReturnValue("admin");
    renderShell("/orders/abc/production");
    const rail = sideRail();
    expect(rail.getByRole("link", { name: "Zakázky" })).toHaveAttribute("aria-current", "page");
    expect(rail.getByRole("link", { name: "Katalog" })).not.toHaveAttribute("aria-current");
  });

  it("lights Nastavení while on one of its child sections (/admin) via activeMatch", () => {
    useRoleMock.mockReturnValue("admin");
    renderShell("/admin");
    expect(sideRail().getByRole("link", { name: "Nastavení" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("hides the priced surfaces from a workshop role, keeps Přehled/Zakázky/Nastavení", () => {
    useRoleMock.mockReturnValue("workshop");
    usePlatformAdminMock.mockReturnValue(false);
    renderShell("/orders");
    const rail = sideRail();
    expect(rail.getByRole("link", { name: "Přehled" })).toBeInTheDocument();
    expect(rail.getByRole("link", { name: "Zakázky" })).toBeInTheDocument();
    expect(rail.getByRole("link", { name: "Nastavení" })).toBeInTheDocument();
    expect(rail.queryByRole("link", { name: "Katalog" })).toBeNull();
    expect(rail.queryByRole("link", { name: "Nabídky" })).toBeNull();
  });

  it("an org-less session (role null) sees only Nastavení", () => {
    useRoleMock.mockReturnValue(null);
    usePlatformAdminMock.mockReturnValue(false);
    renderShell("/account");
    const rail = sideRail();
    expect(rail.getByRole("link", { name: "Nastavení" })).toBeInTheDocument();
    expect(rail.queryByRole("link", { name: "Přehled" })).toBeNull();
    expect(rail.queryByRole("link", { name: "Zakázky" })).toBeNull();
  });

  it("an org-less platform operator gains Platforma", () => {
    useRoleMock.mockReturnValue(null);
    usePlatformAdminMock.mockReturnValue(true);
    renderShell("/platform");
    const rail = sideRail();
    expect(rail.getByRole("link", { name: "Platforma" })).toBeInTheDocument();
    expect(rail.getByRole("link", { name: "Nastavení" })).toBeInTheDocument();
  });
});

describe("AppShell — mobile tab bar suppression", () => {
  it("suppresses the tab bar where the surface owns a bottom action bar (/configurator)", () => {
    useRoleMock.mockReturnValue("admin");
    renderShell("/configurator");
    expect(screen.queryByTestId("app-tab-bar")).toBeNull();
    // the other renderings still frame the surface
    expect(screen.getByTestId("app-side-rail")).toBeInTheDocument();
  });

  it("keeps the tab bar on an ordinary detail surface", () => {
    useRoleMock.mockReturnValue("admin");
    renderShell("/orders/abc/production");
    expect(screen.getByTestId("app-tab-bar")).toBeInTheDocument();
  });

  it("also suppresses the tab bar on a /configurator/* subpath (defensive startsWith branch)", () => {
    useRoleMock.mockReturnValue("admin");
    renderShell("/configurator/step-2");
    expect(screen.queryByTestId("app-tab-bar")).toBeNull();
  });

  it("renders no empty tab bar when the main group is empty (role null), keeping the top-bar escape", () => {
    useRoleMock.mockReturnValue(null);
    usePlatformAdminMock.mockReturnValue(false);
    renderShell("/account");
    expect(screen.queryByTestId("app-tab-bar")).toBeNull();
    expect(screen.getByTestId("app-mobile-topbar")).toBeInTheDocument();
  });
});
