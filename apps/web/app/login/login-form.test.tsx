import { render, screen } from "@testing-library/react";
import { type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { ApiProvider } from "@repo/api/react";
import { AuthProvider } from "@repo/auth/react";
import { cs } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";

import { LoginForm } from "./login-form";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

function Wrap({ children }: { children: ReactNode }) {
  return (
    <I18nProvider locale="cs" messages={cs}>
      <ApiProvider baseUrl="https://test.local/api">
        <AuthProvider baseUrl="https://test.local">{children}</AuthProvider>
      </ApiProvider>
    </I18nProvider>
  );
}

describe("LoginForm", () => {
  it("submits over POST so a pre-hydration submit cannot leak the password into the URL", () => {
    render(
      <Wrap>
        <LoginForm />
      </Wrap>,
    );

    // A form with no `method` defaults to GET. The React `onSubmit` handler only
    // exists once the island has hydrated, so the native fallback submit is the
    // one that matters here — and under GET it would append `password=…` to the
    // query string. Asserting the rendered attribute, not the handler, is what
    // pins that: a test driving `onSubmit` would pass even with `method` unset.
    // Reached through the password field's own form owner, so the assertion
    // tracks the invariant (a credential-bearing form posts) rather than a
    // position in the markup.
    const password = screen.getByLabelText(cs.auth.password);
    expect(password).toHaveAttribute("type", "password");

    const form = (password as HTMLInputElement).form;
    expect(form).not.toBeNull();
    expect(form?.getAttribute("method")).toBe("post");
  });
});
