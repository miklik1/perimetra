import { afterEach, describe, expect, it, vi } from "vitest";

const PROD_ENV = {
  VERCEL_TARGET_ENV: "production",
  API_URL: "https://be.example.com/api/v1",
} as const;

/**
 * Every env var this guard reads. Each case starts from a CLEAN slate: an
 * ambient shell var must never decide the outcome. A gate/pre-push leg that
 * exports e.g. `API_URL=https://gate.invalid` (a web build may need one) would
 * otherwise leak in and silently satisfy the "prod requires API_URL" case — a
 * false green. Empty string ⇒ undefined via `emptyStringAsUndefined`, and a
 * falsy `SKIP_ENV_VALIDATION` / `VERCEL_TARGET_ENV` reads as absent.
 */
const TIER_VARS = [
  "VERCEL_TARGET_ENV",
  "APP_TIER",
  "API_URL",
  "NEXT_PUBLIC_ENABLE_MSW",
  "SKIP_ENV_VALIDATION",
] as const;

/** Stub env (clean slate for every tier var), reset modules, import a fresh assert. */
async function loadAssert(vars: Record<string, string>) {
  for (const k of TIER_VARS) vi.stubEnv(k, vars[k] ?? "");
  vi.resetModules();
  return (await import("./assert-tier-invariants")).assertTierInvariants;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("assertTierInvariants (minimal generalized tier guard)", () => {
  it("passes for a clean preview (default tier, no backend)", async () => {
    const assert = await loadAssert({});
    expect(() => assert()).not.toThrow();
  });

  it("passes for a clean prod (API_URL set, no mocks)", async () => {
    const assert = await loadAssert({ ...PROD_ENV });
    expect(() => assert()).not.toThrow();
  });

  it("passes for stage (no hard constraints — the mock/real mix is the point)", async () => {
    const assert = await loadAssert({
      VERCEL_TARGET_ENV: "stage",
      NEXT_PUBLIC_ENABLE_MSW: "true",
      API_URL: "https://stage.example.com/api",
    });
    expect(() => assert()).not.toThrow();
  });

  it("throws on prod with mocks enabled (no mock-leak to the live tier)", async () => {
    const assert = await loadAssert({ ...PROD_ENV, NEXT_PUBLIC_ENABLE_MSW: "true" });
    expect(() => assert()).toThrow(/NEXT_PUBLIC_ENABLE_MSW/);
  });

  it("throws on prod missing API_URL (the live tier has no real backend origin)", async () => {
    const assert = await loadAssert({ VERCEL_TARGET_ENV: "production" });
    expect(() => assert()).toThrow(/API_URL/);
  });

  // Perimetra deviates from the skeleton here (ADR 0104): a real-backend product
  // legitimately carries API_URL on preview. Only an AMBIGUOUS data source throws.
  it("passes on preview carrying API_URL with mocks unset (the real-backend product path)", async () => {
    const assert = await loadAssert({ API_URL: "https://be.example.com/api/v1" });
    expect(() => assert()).not.toThrow();
  });

  it("passes on preview with mocks off and a backend origin set", async () => {
    const assert = await loadAssert({
      NEXT_PUBLIC_ENABLE_MSW: "false",
      API_URL: "https://be.example.com/api/v1",
    });
    expect(() => assert()).not.toThrow();
  });

  it("throws on preview with mocks ON and API_URL set (ambiguous: the mock silently wins)", async () => {
    const assert = await loadAssert({
      NEXT_PUBLIC_ENABLE_MSW: "true",
      API_URL: "https://be.example.com/api/v1",
    });
    expect(() => assert()).toThrow(/ambiguous data source/);
  });

  it("throws on preview with mocks explicitly disabled and no backend (would proxy the demo default)", async () => {
    const assert = await loadAssert({ NEXT_PUBLIC_ENABLE_MSW: "false" });
    expect(() => assert()).toThrow(/ENABLE_MSW/);
  });

  it("is a no-op under SKIP_ENV_VALIDATION on a non-prod target (Docker/CI escape hatch)", async () => {
    // Mocks-on + API_URL is an illegal preview pair, but SKIP short-circuits the
    // guard for builds where env values aren't present.
    const assert = await loadAssert({
      SKIP_ENV_VALIDATION: "1",
      NEXT_PUBLIC_ENABLE_MSW: "true",
      API_URL: "https://be.example.com/api/v1",
    });
    expect(() => assert()).not.toThrow();
  });

  it("refuses SKIP_ENV_VALIDATION on a Production target (the belt must never silently vanish)", async () => {
    const assert = await loadAssert({ SKIP_ENV_VALIDATION: "1", VERCEL_TARGET_ENV: "production" });
    expect(() => assert()).toThrow(/SKIP_ENV_VALIDATION/);
  });

  it("refuses SKIP_ENV_VALIDATION on a non-Vercel APP_TIER=prod build (the container/standalone prod path)", async () => {
    // The container prod path never sets VERCEL_TARGET_ENV; keying the refusal
    // only on that var would let this build skip the whole guard.
    const assert = await loadAssert({ SKIP_ENV_VALIDATION: "1", APP_TIER: "prod" });
    expect(() => assert()).toThrow(/SKIP_ENV_VALIDATION/);
  });

  it("refuses SKIP_ENV_VALIDATION on a mis-cased Production target (normalised, not literal)", async () => {
    const assert = await loadAssert({ SKIP_ENV_VALIDATION: "1", VERCEL_TARGET_ENV: "Production" });
    expect(() => assert()).toThrow(/SKIP_ENV_VALIDATION/);
  });

  // APP_TIER is the SOLE tier signal on the non-Vercel container prod build, and
  // SKIP_ENV_VALIDATION is that build's documented escape hatch — which disables
  // the schema enum that would otherwise reject a mis-cased value. If
  // `readAppTier` did not lower-case, APP_TIER="PROD" would resolve TIER="preview",
  // skip this refusal entirely, and serve mocks on a prod deploy.
  it("refuses SKIP_ENV_VALIDATION on a mis-cased APP_TIER=prod container build (normalised, not literal)", async () => {
    const assert = await loadAssert({ SKIP_ENV_VALIDATION: "1", APP_TIER: "PROD" });
    expect(() => assert()).toThrow(/SKIP_ENV_VALIDATION/);
  });

  // The other half of the same hole: when validation DOES run, a mis-cased
  // APP_TIER never reaches the guard — `createEnv`'s enum rejects it at module
  // import. Both halves together mean a casing typo can no longer resolve a prod
  // deploy down to the mock-capable preview tier.
  it("rejects a mis-cased APP_TIER at createEnv when validation runs (never reaches the guard)", async () => {
    for (const k of TIER_VARS) vi.stubEnv(k, "");
    vi.stubEnv("APP_TIER", "  Prod ");
    vi.resetModules();
    await expect(import("./assert-tier-invariants")).rejects.toThrow(
      /Invalid environment variables/,
    );
  });
});
