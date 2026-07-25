import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@repo/api";
import { ApiProvider } from "@repo/api/react";
import { cs } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";
import { formatDate } from "@repo/utils";
import { type DeliveryDocumentType } from "@repo/validators";

import { toastStore } from "../../lib/toast";
import { SendDocumentAction, sendRejectionCode } from "./send-document-action";

// Sending is gated on `useRole()`, which normally reads the real `/v1/me` probe
// (mocked in vitest.setup.ts as `role: "admin"`). Mocking the hook directly is
// the narrowest lever for exercising the workshop / unresolved branches — the
// `invoice-detail.test.tsx` idiom. Default `"admin"` so the affordance renders
// unless a test says otherwise.
let mockRole: string | null = "admin";
vi.mock("../../lib/use-role", () => ({ useRole: () => mockRole }));

// ids match the seeded mock stores (`@repo/api-mocks` fixtures/deliveries.ts,
// fixtures/quotes.ts, fixtures/invoices.ts) so every branch below is driven by
// a real mocked route rather than a hand-stubbed client.
/** A seeded quote with NO delivery history — the clean send path. */
const FRESH_QUOTE = "00000000-0000-7000-8000-000000000001";
/** A seeded quote whose send is still queued — the 409 `send_in_progress`. */
const QUEUED_QUOTE = "00000000-0000-7000-8000-000000000003";
/** The seeded (paid) invoice with a completed send — the "Odesláno" state. */
const SENT_INVOICE = "01930000-0000-7000-8000-000000000002";
/** A delivery refusal fixture — the 422 `recipient_email_missing`. */
const NO_EMAIL_DOCUMENT = "00000000-0000-7000-8000-0000000f0003";
/** Names no document at all — a 404, i.e. a code the rejection map cannot name. */
const UNKNOWN_DOCUMENT = "00000000-0000-7000-8000-0000000000cc";

const SENT_AT = "2026-07-22T09:00:05.000Z";

function renderAction(
  documentType: DeliveryDocumentType,
  documentId: string,
  children?: string,
): ReturnType<typeof render> {
  return render(
    <I18nProvider locale="cs" messages={cs}>
      <ApiProvider baseUrl="https://test.local/api">
        <SendDocumentAction documentType={documentType} documentId={documentId}>
          {children}
        </SendDocumentAction>
      </ApiProvider>
    </I18nProvider>,
  );
}

/** The most recent toast the surface fired — the real store, not a spy
 *  (`toaster.test.tsx` idiom); the Toaster itself is not mounted here. */
function lastToast() {
  return toastStore.getState().toasts.at(-1);
}

beforeEach(() => {
  toastStore.getState().clear();
});

afterEach(() => {
  mockRole = "admin";
});

describe("SendDocumentAction — the role gate is FAIL-CLOSED", () => {
  it("admin: offers the send and states that nothing has gone out yet", async () => {
    renderAction("quote", FRESH_QUOTE);
    expect(await screen.findByText("Zatím neodesláno.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Odeslat e-mailem" })).toBeInTheDocument();
  });

  it("workshop: renders nothing at all — not even the explainer", () => {
    mockRole = "workshop";
    const { container } = renderAction("quote", FRESH_QUOTE, "Odběrateli přijde e-mail…");
    expect(container).toBeEmptyDOMElement();
  });

  it("unresolved role: the same closed state, never an optimistic affordance", () => {
    mockRole = null;
    const { container } = renderAction("quote", FRESH_QUOTE, "Odběrateli přijde e-mail…");
    expect(container).toBeEmptyDOMElement();
  });
});

describe("SendDocumentAction — sending is never one click", () => {
  it("the first press only reveals the confirm step; nothing is sent", async () => {
    renderAction("quote", FRESH_QUOTE);
    fireEvent.click(await screen.findByRole("button", { name: "Odeslat e-mailem" }));

    // The confirm names the act AND says plainly that it cannot be undone.
    expect(screen.getByText("Odeslat dokument odběrateli?")).toBeInTheDocument();
    expect(screen.getByText(/Odeslaný e-mail už nelze vzít zpět/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Odeslat" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zpět" })).toBeInTheDocument();

    // The mutation has NOT fired — a queued send would have toasted.
    expect(lastToast()).toBeUndefined();
  });

  it("confirming sends, and the outcome is stated as QUEUED, never as delivered", async () => {
    renderAction("quote", FRESH_QUOTE);
    fireEvent.click(await screen.findByRole("button", { name: "Odeslat e-mailem" }));
    fireEvent.click(screen.getByRole("button", { name: "Odeslat" }));

    await waitFor(() =>
      expect(lastToast()?.message).toBe("Odeslání zařazeno — e-mail odejde během chvíle."),
    );
    expect(lastToast()?.type).toBe("success");
    // The confirm step closes on success, and the row's own state takes over.
    expect(screen.queryByText("Odeslat dokument odběrateli?")).not.toBeInTheDocument();
    expect(await screen.findByText("Odeslání zařazeno…")).toBeInTheDocument();
  });
});

describe("SendDocumentAction — typed refusals reach the rep by NAME", () => {
  it("409 send_in_progress: names the in-flight send and its remedy", async () => {
    renderAction("quote", QUEUED_QUOTE);
    fireEvent.click(await screen.findByRole("button", { name: /Odeslat/ }));
    fireEvent.click(screen.getByRole("button", { name: "Odeslat" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Odeslání už probíhá");
    expect(alert).toHaveTextContent("Předchozí odeslání ještě neskončilo.");
    // A named precondition stays ON SCREEN — it is not a transient toast.
    expect(lastToast()).toBeUndefined();
  });

  it("422 recipient_email_missing: names exactly what is missing and where to fix it", async () => {
    renderAction("quote", NO_EMAIL_DOCUMENT);
    fireEvent.click(await screen.findByRole("button", { name: "Odeslat e-mailem" }));
    fireEvent.click(screen.getByRole("button", { name: "Odeslat" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Odběratel nemá e-mail");
    expect(alert).toHaveTextContent("Doplňte ji v kartě odběratele");
    expect(lastToast()).toBeUndefined();
  });

  it("an unnameable failure falls through to the shared error catalog — never swallowed", async () => {
    renderAction("quote", UNKNOWN_DOCUMENT);
    fireEvent.click(await screen.findByRole("button", { name: "Odeslat e-mailem" }));
    fireEvent.click(screen.getByRole("button", { name: "Odeslat" }));

    await waitFor(() => expect(lastToast()?.message).toBe("Požadovaná položka nebyla nalezena."));
    expect(lastToast()?.type).toBe("error");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

/**
 * The recogniser, tested directly (the `issueRejectionCode` precedent). The mock
 * tier can drive three of these through a real render; the remaining two derive
 * from customer/lineage state it does not model. Pinning the map here is what
 * keeps it honest when a backend code is renamed — a silent miss would downgrade
 * a named remedy into the generic toast without a single test going red.
 */
describe("sendRejectionCode — the named send refusals", () => {
  const apiError = (status: number, body: unknown) =>
    new ApiError({ kind: "http", status, message: "err", body });

  it.each(["customer_required", "customer_anonymized", "recipient_email_missing"])(
    "recognises the 422 precondition %s",
    (code) => {
      expect(sendRejectionCode(apiError(422, { code }))).toBe(code);
    },
  );

  it.each(["document_superseded", "send_in_progress"])("recognises the 409 conflict %s", (code) => {
    expect(sendRejectionCode(apiError(409, { code }))).toBe(code);
  });

  it("ignores an unknown code on either status, a 500, and a non-ApiError", () => {
    expect(sendRejectionCode(apiError(422, { code: "something_new" }))).toBeUndefined();
    expect(sendRejectionCode(apiError(409, { code: "something_new" }))).toBeUndefined();
    // A 500 names nothing the rep can fix, so it must fall through to the
    // generic mapped toast rather than borrow a precondition's copy.
    expect(sendRejectionCode(apiError(500, { code: "customer_required" }))).toBeUndefined();
    // A 404 is the document read failing — the shared catalog answers it.
    expect(sendRejectionCode(apiError(404, { code: "customer_required" }))).toBeUndefined();
    expect(sendRejectionCode(apiError(422, null))).toBeUndefined();
    expect(sendRejectionCode(new Error("boom"))).toBeUndefined();
    expect(sendRejectionCode(null)).toBeUndefined();
  });
});

describe("SendDocumentAction — a completed send", () => {
  it("reads as HANDED OFF with its date, and offers a deliberate re-send", async () => {
    renderAction("invoice", SENT_INVOICE);
    // "Odesláno" — handed to the mail server. There is no bounce feedback loop,
    // so no surface may upgrade this to "doručeno".
    expect(
      await screen.findByText(`Odesláno ${formatDate(SENT_AT, undefined, "cs")}`),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Odeslat znovu" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Odeslat e-mailem" })).not.toBeInTheDocument();
  });
});
