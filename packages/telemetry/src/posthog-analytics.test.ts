import { describe, expect, it, vi } from "vitest";

import { createPosthogAnalytics, type PosthogAnalyticsClient } from "./posthog-analytics";

const fakeClient = () => ({
  capture: vi.fn<PosthogAnalyticsClient["capture"]>(),
  identify: vi.fn<PosthogAnalyticsClient["identify"]>(),
  reset: vi.fn<PosthogAnalyticsClient["reset"]>(),
});

describe("createPosthogAnalytics", () => {
  it("trackEvent maps to capture(name, props)", () => {
    const client = fakeClient();
    createPosthogAnalytics(client).trackEvent("checkout_started", { step: 1 });
    expect(client.capture).toHaveBeenCalledWith("checkout_started", { step: 1 });
  });

  it("screen maps to the canonical $screen event", () => {
    const client = fakeClient();
    createPosthogAnalytics(client).screen("Account", { tab: "profile" });
    expect(client.capture).toHaveBeenCalledWith("$screen", {
      $screen_name: "Account",
      tab: "profile",
    });
  });

  it("identify ships exactly id + email + username (the audited PII set)", () => {
    const client = fakeClient();
    createPosthogAnalytics(client).identify({
      id: "u1",
      email: "a@b.cz",
      username: "Anna",
    });
    expect(client.identify).toHaveBeenCalledWith("u1", { email: "a@b.cz", username: "Anna" });
  });

  it("reset maps to reset", () => {
    const client = fakeClient();
    createPosthogAnalytics(client).reset();
    expect(client.reset).toHaveBeenCalledOnce();
  });

  it("trackEvent scrubs PII props before capture", () => {
    const client = fakeClient();
    createPosthogAnalytics(client).trackEvent("checkout_started", {
      email: "a@b.cz",
      token: "secret-token",
      step: 1,
    });
    expect(client.capture).toHaveBeenCalledWith("checkout_started", {
      email: "[Filtered]",
      token: "[Filtered]",
      step: 1,
    });
  });

  it("screen scrubs PII props before capture (screen_name preserved)", () => {
    const client = fakeClient();
    createPosthogAnalytics(client).screen("Account", { note: "mail a@b.cz" });
    expect(client.capture).toHaveBeenCalledWith("$screen", {
      $screen_name: "Account",
      note: "mail [Filtered]",
    });
  });
});

describe("createPosthogAnalytics — ADR 1031: both vocabularies on the EXPLICIT sink", () => {
  it("reduces a RELATIVE href and drops a bare search term on trackEvent AND screen", () => {
    // The adapter ran the Sentry walk alone, whose URL key list deliberately
    // excludes the analytics names — so this exact call shipped the surname
    // while the AUTOCAPTURED twin of the same value was reduced correctly in the
    // same session. Assert SAFETY (no marker anywhere), not just the shape.
    const sent: [string, Record<string, unknown> | undefined][] = [];
    const analytics = createPosthogAnalytics({
      capture: (event, properties) => sent.push([event, properties]),
      identify: () => undefined,
      reset: () => undefined,
    });
    analytics.trackEvent("row_clicked", {
      href: "/clients?search=Novakova&rc=8001011234",
      ph_keyword: "Novakova 800101/1234",
    });
    analytics.screen("Detail", { href: "/clients?search=Novakova" });
    expect(JSON.stringify(sent)).not.toContain("Novakova");
    expect(sent[0]?.[1]?.href).toBe("/clients");
    expect(sent[0]?.[1]?.ph_keyword).toBe("[Filtered]");
    expect(sent[1]?.[1]?.href).toBe("/clients");
    // The screen name still rides along — this is a scrub, not a drop.
    expect(sent[1]?.[1]?.$screen_name).toBe("Detail");
  });
});
