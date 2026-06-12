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
});
