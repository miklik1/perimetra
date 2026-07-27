// @vitest-environment node
// (spawns real child processes and asserts on real exit codes — needs Node, and
// the whole point of this suite is that it does NOT trust in-process exception
// semantics. See ADR 1027.)
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * ADR 1027 — `check-types` must be UNSATISFIABLE WITHOUT RUNNING.
 *
 * The defect these tests pin: `next typegen` reports a config-load failure as an
 * unhandled promise rejection and exits 0, so `next typegen && tsc --noEmit`
 * proceeded and the gate was green on exactly the `API_URL` values ADR 1021
 * exists to refuse. The fix is a preflight that evaluates the real config in a
 * process we own and exits explicitly.
 *
 * Every test here asserts an EXIT CODE from a real child process. That is
 * deliberate: an in-process `expect(() => ...).toThrow()` would be testing the
 * very unhandled-rejection semantics that caused the defect.
 */

const WEB_DIR = fileURLToPath(new URL("..", import.meta.url));
const PREFLIGHT = fileURLToPath(new URL("./preflight-config.mjs", import.meta.url));

/** A plaintext REMOTE host — the exact case ADR 1021's rule exists to refuse. */
const PLAINTEXT_REMOTE_API_URL = "http://staging.internal:4000";

/**
 * Build a child env with the vars under test controlled explicitly. Every var
 * the tier guard reads is DELETED before applying overrides: a developer (or
 * CI) with any of them exported in the ambient shell would otherwise silently
 * change what these tests measure — `SKIP_ENV_VALIDATION` in particular
 * disables the whole validation path and would make the negative tests pass for
 * the wrong reason.
 *
 * PERIMETRA DELTA vs the upstream suite: `NEXT_PUBLIC_ENABLE_MSW` and
 * `APP_TIER` are deleted too. Perimetra's preview rule is a PAIR rule (see the
 * T1b comment below), so an ambient `NEXT_PUBLIC_ENABLE_MSW=false` alone is a
 * violation here and would red the positive control T2 for a reason that has
 * nothing to do with the preflight.
 */
function childEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.API_URL;
  delete env.SKIP_ENV_VALIDATION;
  delete env.NEXT_PUBLIC_ENABLE_MSW;
  delete env.APP_TIER;
  return { ...env, ...overrides };
}

function runPreflight(overrides: Record<string, string> = {}) {
  return spawnSync(process.execPath, [PREFLIGHT], {
    cwd: WEB_DIR,
    env: childEnv(overrides),
    encoding: "utf8",
  });
}

describe("check-types preflight", () => {
  // T1 — the load-bearing one. Disarm (make the catch arm exit 0) → RED.
  it("EXITS NON-ZERO on a plaintext remote API_URL (the value the pre-fix gate shrugged off)", () => {
    const result = runPreflight({ API_URL: PLAINTEXT_REMOTE_API_URL });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/API_URL must use https/);
  });

  // T1b — the SECOND swallowed throw site, measured during this work and not in
  // the original defect report: `assertTierInvariants()` (next.config.js:17) was
  // ALSO swallowed by `next typegen` into an exit-0. Importing the whole config
  // rather than just the env module is what covers it. Disarm the preflight →
  // RED. This is why ADR 1027 claims to close a CLASS, not one instance.
  //
  // PERIMETRA DELTA: upstream triggers this with a bare `API_URL` on preview,
  // because the skeleton forbids `API_URL` on preview outright. Perimetra
  // deliberately REVERSED that rule (ADR 0104 / `assert-tier-invariants.ts`) —
  // it is a real-backend product, so preview legitimately points at a real api
  // and the bare-`API_URL` case is the NORMAL configuration here. Perimetra's
  // equivalent preview violation is the ambiguous-data-source PAIR: mocks
  // explicitly on WITH a backend origin, where the mock wins at the BFF and the
  // configured origin is silently ignored. Same throw site, same swallowed-into-
  // exit-0 defect, expressed in this repo's own rule.
  it("EXITS NON-ZERO on a tier-invariant violation, not just an env-schema failure", () => {
    const result = runPreflight({
      NEXT_PUBLIC_ENABLE_MSW: "true",
      API_URL: "http://localhost:4000",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/assertTierInvariants/);
  });

  // T2 — the positive control. Without it, a preflight that exits 1
  // unconditionally would satisfy T1 and break every developer's gate.
  // Disarm (always exit 1) → RED.
  it("EXITS ZERO on a valid environment (no API_URL on the default preview tier)", () => {
    const result = runPreflight();

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  // T2b — a second positive control on a different tier, so "exits 0" is not
  // pinned to one lucky env shape.
  it("EXITS ZERO on a prod tier with an https API_URL", () => {
    const result = runPreflight({ APP_TIER: "prod", API_URL: "https://api.example.com" });

    expect(result.status).toBe(0);
  });

  // The preflight must be invocable from anywhere — turbo, CI and pnpm do not
  // agree on cwd. It resolves the config relative to its own module URL.
  it("resolves next.config.js relative to itself, not to the working directory", () => {
    const result = spawnSync(process.execPath, [PREFLIGHT], {
      cwd: fileURLToPath(new URL("../../..", import.meta.url)), // repo root
      env: childEnv({ API_URL: PLAINTEXT_REMOTE_API_URL }),
      encoding: "utf8",
    });

    // Still a config REJECTION (exit 1 + the rule's message), not a
    // module-not-found, which would prove it had failed for the wrong reason.
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/API_URL must use https/);
    expect(result.stderr).not.toMatch(/ERR_MODULE_NOT_FOUND/);
  });
});

describe("check-types chain shape", () => {
  const webPackageJson = JSON.parse(
    readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
  ) as { scripts: Record<string, string> };

  // T3 — pins the actual regression path: someone "simplifying" the script back
  // to `next typegen && tsc --noEmit`. Weak on its own (it is a string match),
  // which is exactly why T4 below exists. Disarm (revert the string) → RED.
  it("runs the preflight FIRST, before next typegen can swallow anything", () => {
    expect(webPackageJson.scripts["check-types"]).toMatch(
      /^node scripts\/preflight-config\.mjs\s*&&/,
    );
  });

  it("still runs next typegen and tsc after the preflight (the preflight ADDS a gate, it does not replace one)", () => {
    expect(webPackageJson.scripts["check-types"]).toMatch(/next typegen\s*&&\s*tsc --noEmit\s*$/);
  });
});

describe("check-types end-to-end", () => {
  // T4 — the disarm-proof one. This reddens for BOTH disarms (reverting the
  // script string AND making the catch arm exit 0), because it measures the
  // property the ADR is actually about: the gate cannot be satisfied without
  // running. T3 alone would not catch a broken preflight; T1 alone would not
  // catch the script being reverted.
  //
  // Cheap despite invoking the full chain: with a bad env the chain
  // SHORT-CIRCUITS at the preflight, so `next typegen` and `tsc` never run.
  it("fails the whole check-types script on a plaintext remote API_URL", () => {
    const result = spawnSync("pnpm", ["run", "check-types"], {
      cwd: WEB_DIR,
      env: childEnv({ API_URL: PLAINTEXT_REMOTE_API_URL }),
      encoding: "utf8",
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/API_URL must use https/);
  }, 60_000);
});

describe("check-types script shape across the other apps", () => {
  // T5 — pins the audit finding rather than re-deriving it. apps/web is the ONLY
  // workspace whose check-types is not a bare `tsc --noEmit`; every other app
  // therefore has no pre-step that could swallow a failure. This reddens if
  // someone later chains a swallowing pre-step onto another app.
  it.each(["mobile", "api"])("apps/%s check-types is a bare tsc --noEmit", (app) => {
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL(`../../${app}/package.json`, import.meta.url)), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(pkg.scripts["check-types"]).toBe("tsc --noEmit");
  });
});
