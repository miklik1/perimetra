import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiProvider } from "@repo/api/react";
import { cs } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";

import SharedNabidkaPage from "./page";

/**
 * The ACCEPTANCE suite for ADR 0130 — the buyer's shareToken moved out of the URL
 * and into the URL FRAGMENT.
 *
 * Every case here is about the CARRIER, not about the landing (that is
 * `shared-nabidka-view.test.tsx`, which is unchanged by this slice because the
 * view stayed a props-in leaf). Each one must genuinely red if the page starts
 * reading the token from a path segment, forgets the `replaceState`, or sends the
 * token in a URL: those are the three ways this design silently degrades back
 * into the leak it exists to close.
 */

/** The first seeded mock quote (`seedQuote(1)` → `share-` + a 12-digit pad). */
const TOKEN = "share-000000000001";
const DOCUMENT_NUMBER = "2026/0001";

function renderPage() {
  return render(
    <I18nProvider locale="cs" messages={cs}>
      <ApiProvider baseUrl="https://test.local/api">
        <SharedNabidkaPage />
      </ApiProvider>
    </I18nProvider>,
  );
}

/**
 * Record every outgoing request while still letting MSW answer it. The spy wraps
 * whatever `fetch` is installed at call time — MSW has already patched it in
 * `beforeAll` — so this observes the real request the app makes rather than a
 * stand-in.
 */
function captureRequests() {
  const seen: { url: string; body: string | null }[] = [];
  const real = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const body = typeof init?.body === "string" ? init.body : null;
    seen.push({ url, body });
    return real(input as RequestInfo, init);
  });
  return seen;
}

function setHash(hash: string) {
  window.history.replaceState(null, "", `/nabidka${hash}`);
}

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("/nabidka (ADR 0130 — the shareToken rides the fragment)", () => {
  it("resolves the quote from the fragment and renders the landing", async () => {
    setHash(`#${TOKEN}`);
    renderPage();
    expect(await screen.findByText(DOCUMENT_NUMBER)).toBeInTheDocument();
  });

  it("strips the fragment from the address bar before anything can read it", async () => {
    setHash(`#${TOKEN}`);
    renderPage();
    await waitFor(() => expect(window.location.hash).toBe(""));
    expect(window.location.pathname).toBe("/nabidka");
  });

  it("never puts the token in a request URL — it travels in the JSON body", async () => {
    const seen = captureRequests();
    setHash(`#${TOKEN}`);
    renderPage();
    await screen.findByText(DOCUMENT_NUMBER);

    expect(seen.length).toBeGreaterThan(0);
    for (const request of seen) {
      expect(request.url).not.toContain(TOKEN);
    }
    const resolve = seen.find((r) => r.url.endsWith("/v1/quotes/shared/resolve"));
    expect(resolve, "the resolve POST was not observed").toBeDefined();
    expect(JSON.parse(resolve!.body ?? "{}")).toEqual({ token: TOKEN });
  });

  it("shows the invalid-link state and fires NO request when there is no fragment", async () => {
    const seen = captureRequests();
    setHash("");
    renderPage();
    expect(await screen.findByText(cs.quotes.buyer.invalidTitle)).toBeInTheDocument();
    expect(seen).toHaveLength(0);
  });

  it("shows the SAME invalid-link state for an unknown token — no existence oracle", async () => {
    setHash("#share-does-not-exist");
    renderPage();
    expect(await screen.findByText(cs.quotes.buyer.invalidTitle)).toBeInTheDocument();
  });

  it("decodes a percent-encoded fragment (mail clients re-encode links)", async () => {
    const seen = captureRequests();
    setHash(`#${encodeURIComponent(TOKEN)}`);
    renderPage();
    await screen.findByText(DOCUMENT_NUMBER);
    const resolve = seen.find((r) => r.url.endsWith("/v1/quotes/shared/resolve"));
    expect(JSON.parse(resolve!.body ?? "{}")).toEqual({ token: TOKEN });
  });
});
