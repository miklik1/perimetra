import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ApiProvider } from "@repo/api/react";
import { cs } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";
import type { LegalProfile, UpsertLegalProfileInput } from "@repo/validators";

import { LegalProfileForm } from "./legal-profile-form";

// The org legal-profile endpoint has NO MSW mock route (unlike projects/
// customers), so letting the submit reach `client.apiFetch` would trip the
// setup's `onUnhandledRequest: "error"`. Spy on the queries module's `upsert`
// mutationFn instead: the form calls `mutation.mutate(toInput(values))`, so the
// spy's first argument is EXACTLY `toInput(values)` — asserting it pins the
// form→contract mapping (esp. the IBAN wiring behind the invoice
// `iban_required` gate in invoices.service.ts) without any network.
// Typed via the `vi.fn<T>()` generic (not a named param) so the recorded call
// tuple is `[UpsertLegalProfileInput]` — `.mock.calls[0][0]` typechecks — without
// an unused `_input` that would trip the zero-warnings lint gate.
const upsertSpy = vi.hoisted(() =>
  vi.fn<(input: UpsertLegalProfileInput) => Promise<unknown>>(async () => ({})),
);

vi.mock("../../../lib/legal-profile-queries", async (importActual) => {
  const actual = await importActual<typeof import("../../../lib/legal-profile-queries")>();
  return {
    ...actual,
    // Keep `legalProfileKeys` (spread) real for the onSuccess invalidate; swap
    // only the endpoint factory so `upsert()` resolves to the capturing spy.
    createLegalProfileQueries: (() => ({
      upsert: () => ({ mutationFn: upsertSpy }),
    })) as unknown as typeof actual.createLegalProfileQueries,
  };
});

// jsdom ships no ResizeObserver; the kit `Switch` (vatPayer) mounts inside a
// <form>, which keeps Radix's hidden bubble-input mounted (`isFormControl`),
// sized via `useSize` → `ResizeObserver` (same stub `customer-form.test.tsx` uses).
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => upsertSpy.mockClear());

const IBAN_LABEL = cs.legalProfile.fields.iban;

function makeProfile(overrides: Partial<LegalProfile> = {}): LegalProfile {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    name: "Dodavatel s.r.o.",
    ico: null,
    dic: null,
    vatPayer: false,
    addressLine: null,
    city: null,
    postalCode: null,
    country: "CZ",
    bankAccount: null,
    iban: "CZ6508000000192000145399",
    registrationNote: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderForm(initial: LegalProfile | null) {
  return render(
    <I18nProvider locale="cs" messages={cs}>
      <ApiProvider baseUrl="https://test.local/api">
        <LegalProfileForm initial={initial} />
      </ApiProvider>
    </I18nProvider>,
  );
}

describe("LegalProfileForm — IBAN wiring (ADR 0112 §5)", () => {
  it("populates the IBAN field from an initial profile (toDefaults maps initial.iban)", () => {
    renderForm(makeProfile({ iban: "CZ6508000000192000145399" }));
    expect(screen.getByLabelText(IBAN_LABEL)).toHaveValue("CZ6508000000192000145399");
  });

  it("sends the trimmed IBAN through toInput on submit", async () => {
    renderForm(makeProfile({ iban: "" }));
    fireEvent.change(screen.getByLabelText(IBAN_LABEL), {
      target: { value: "  CZ6508000000192000145399  " },
    });
    fireEvent.click(screen.getByRole("button", { name: cs.legalProfile.save }));

    await waitFor(() => expect(upsertSpy).toHaveBeenCalledTimes(1));
    expect(upsertSpy.mock.calls[0]?.[0]).toMatchObject({ iban: "CZ6508000000192000145399" });
  });

  it("maps a cleared IBAN to null on submit (blank → null)", async () => {
    renderForm(makeProfile({ iban: "CZ6508000000192000145399" }));
    fireEvent.change(screen.getByLabelText(IBAN_LABEL), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: cs.legalProfile.save }));

    await waitFor(() => expect(upsertSpy).toHaveBeenCalledTimes(1));
    expect(upsertSpy.mock.calls[0]?.[0]).toMatchObject({ iban: null });
  });
});
