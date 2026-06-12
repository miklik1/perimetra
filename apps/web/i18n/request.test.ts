import { beforeEach, describe, expect, it, vi } from "vitest";

import { cs, DEFAULT_LOCALE, en } from "@repo/i18n";

// Drive the RSC cookie read. `vi.hoisted` so the mock factory (hoisted above the
// imports) can reach the mutable value.
const state = vi.hoisted(() => ({ cookie: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "locale" && state.cookie !== undefined ? { value: state.cookie } : undefined,
  }),
}));

// `@repo/i18n/web/server` re-exports from `next-intl/server` (which pulls in
// `server-only`); stub it so the test stays hermetic — `buildRequestConfig`
// itself only touches `next/headers` + the catalogs.
vi.mock("next-intl/server", () => ({
  getLocale: vi.fn(),
  getTranslations: vi.fn(),
  getFormatter: vi.fn(),
  getNow: vi.fn(),
  getTimeZone: vi.fn(),
}));

const { buildRequestConfig } = await import("@repo/i18n/web/server");

beforeEach(() => {
  state.cookie = undefined;
});

describe("buildRequestConfig (RSC, without i18n routing)", () => {
  it("resolves the cs catalog when the locale cookie is cs", async () => {
    state.cookie = "cs";
    const config = await buildRequestConfig();
    expect(config.locale).toBe("cs");
    expect(config.messages).toBe(cs);
  });

  it("flips to the en catalog when the cookie is en", async () => {
    state.cookie = "en";
    const config = await buildRequestConfig();
    expect(config.locale).toBe("en");
    expect(config.messages).toBe(en);
  });

  it("falls back to DEFAULT_LOCALE for a missing or unknown cookie", async () => {
    expect((await buildRequestConfig()).locale).toBe(DEFAULT_LOCALE);
    state.cookie = "fr";
    expect((await buildRequestConfig()).locale).toBe(DEFAULT_LOCALE);
  });
});
