import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { cs } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";

import { NavShell } from "./nav-shell";

// `@repo/navigation`'s web binding re-exports next/navigation's `usePathname`
// verbatim, and its `Link` wraps `next/link` — mocking `next/navigation` here
// covers both (same pattern as release-editor.test.tsx).
const { usePathnameMock } = vi.hoisted(() => ({ usePathnameMock: vi.fn(() => "/projects") }));
vi.mock("next/navigation", () => ({
  usePathname: usePathnameMock,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const { useAuthMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(() => ({ isAuthenticated: true, sessionValidated: true })),
}));
vi.mock("@repo/auth/react", () => ({ useAuth: useAuthMock }));

// The shell's role context comes straight from `lib/use-role.ts` — mocked here
// (not the underlying `/v1/me` query) so each test pins role/platform-admin
// directly instead of round-tripping through MSW; the registry's OWN role
// matrix is proven in `lib/nav-registry.test.ts`.
const { useRoleMock, usePlatformAdminMock } = vi.hoisted(() => ({
  useRoleMock: vi.fn(() => "admin" as string | null),
  usePlatformAdminMock: vi.fn(() => false),
}));
vi.mock("../lib/use-role", () => ({
  useRole: useRoleMock,
  usePlatformAdmin: usePlatformAdminMock,
}));

function renderShell() {
  return render(
    <I18nProvider locale="cs" messages={cs}>
      <NavShell />
    </I18nProvider>,
  );
}

describe("NavShell", () => {
  it("renders nothing when unauthenticated", () => {
    useAuthMock.mockReturnValue({ isAuthenticated: false, sessionValidated: true });
    usePathnameMock.mockReturnValue("/projects");
    const { container } = renderShell();
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing on a public route even when authenticated", () => {
    useAuthMock.mockReturnValue({ isAuthenticated: true, sessionValidated: true });
    usePathnameMock.mockReturnValue("/login");
    const { container } = renderShell();
    expect(container).toBeEmptyDOMElement();

    usePathnameMock.mockReturnValue("/nabidka/tok123");
    const second = renderShell();
    expect(second.container).toBeEmptyDOMElement();
  });

  it("shows the brand + role-visible entries for an authenticated admin", () => {
    useAuthMock.mockReturnValue({ isAuthenticated: true, sessionValidated: true });
    usePathnameMock.mockReturnValue("/projects");
    useRoleMock.mockReturnValue("admin");
    usePlatformAdminMock.mockReturnValue(false);
    renderShell();
    expect(screen.getByText("Perimetra")).toBeInTheDocument();
    expect(screen.getByText("Konfigurátor")).toBeInTheDocument();
    expect(screen.getByText("Nabídky")).toBeInTheDocument();
    expect(screen.getByText("Správa")).toBeInTheDocument();
    expect(screen.queryByText("Platforma")).not.toBeInTheDocument();
  });

  it("marks the active surface via aria-current, prefix-matched", () => {
    useAuthMock.mockReturnValue({ isAuthenticated: true, sessionValidated: true });
    usePathnameMock.mockReturnValue("/projects");
    useRoleMock.mockReturnValue("admin");
    usePlatformAdminMock.mockReturnValue(false);
    renderShell();
    expect(screen.getByText("Projekty")).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Konfigurátor")).not.toHaveAttribute("aria-current");
  });

  it("hides admin/platform from a workshop role, keeps the price-bearing quotes link", () => {
    useAuthMock.mockReturnValue({ isAuthenticated: true, sessionValidated: true });
    usePathnameMock.mockReturnValue("/quotes");
    useRoleMock.mockReturnValue("workshop");
    usePlatformAdminMock.mockReturnValue(false);
    renderShell();
    expect(screen.getByText("Nabídky")).toBeInTheDocument();
    expect(screen.queryByText("Správa")).not.toBeInTheDocument();
    expect(screen.queryByText("Platforma")).not.toBeInTheDocument();
  });

  it("an org-less/still-resolving session (role null) sees only account, never crashes", () => {
    useAuthMock.mockReturnValue({ isAuthenticated: true, sessionValidated: true });
    usePathnameMock.mockReturnValue("/account");
    useRoleMock.mockReturnValue(null);
    usePlatformAdminMock.mockReturnValue(false);
    renderShell();
    expect(screen.getByText("Účet")).toBeInTheDocument();
    expect(screen.queryByText("Projekty")).not.toBeInTheDocument();
    expect(screen.queryByText("Nabídky")).not.toBeInTheDocument();
  });

  it("an org-less platform operator sees platform + account", () => {
    useAuthMock.mockReturnValue({ isAuthenticated: true, sessionValidated: true });
    usePathnameMock.mockReturnValue("/platform");
    useRoleMock.mockReturnValue(null);
    usePlatformAdminMock.mockReturnValue(true);
    renderShell();
    expect(screen.getByText("Platforma")).toBeInTheDocument();
    expect(screen.getByText("Účet")).toBeInTheDocument();
    expect(screen.queryByText("Projekty")).not.toBeInTheDocument();
  });
});
