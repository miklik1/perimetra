/**
 * Tests for the `require-redirect-posture-on-guarded-fetch` rule.
 *
 * RuleTester throws on any failed assertion; the vitest `it` is the
 * test-registration hook required by vitest.
 *
 * The invalid cases ARE the disarm-verification: each one is a real call-site
 * shape with the `redirect` line removed, and the rule must go red on it. The
 * valid cases pin the two accepted postures and the documented blind spots, so
 * a later "tighten it up" edit that removes an under-flag has to remove a
 * passing assertion to do it.
 */
import { RuleTester } from "eslint";
import { describe, expect, it } from "vitest";

import rule from "../require-redirect-posture-on-guarded-fetch.js";

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

const GUARD_IMPORT = `import { assertEgressUrlAllowed } from "../../common/http/ssrf-guard.js";`;

ruleTester.run("require-redirect-posture-on-guarded-fetch", rule, {
  valid: [
    // ---- the two accepted postures, inline ------------------------------
    {
      code: `${GUARD_IMPORT}
        const res = await fetch(url, { method: "POST", redirect: "manual" });`,
    },
    {
      code: `${GUARD_IMPORT}
        const res = await fetch(url, { redirect: "error" });`,
    },
    // ---- the real skeleton shape: init built above, fetched below -------
    {
      code: `${GUARD_IMPORT}
        const init = { method: "POST", body, redirect: "manual" };
        const res = await fetch(target.href, init);`,
    },
    // ---- a dispatcher-attaching fetch in a module with NO guard import --
    {
      code: `const res = await fetch(url, { dispatcher: agent, redirect: "manual" });`,
    },
    // ---- an UNGUARDED module is none of the rule's business -------------
    // A fixed operator-configured target is trusted first-party and correctly
    // needs no guard at all — so it needs no posture either.
    { code: `const res = await fetch(process.env.CENTRIFUGO_URL + "/api/publish");` },
    { code: `const res = await fetch(presignedUrl, { method: "PUT", body });` },
    // ---- documented blind spots (conservative under-flag) ---------------
    // Init unresolvable to an object literal → cannot prove absence.
    {
      code: `${GUARD_IMPORT}
        export async function send(url, init) { return await fetch(url, init); }`,
    },
    // A spread may carry `redirect` — not flagged.
    {
      code: `${GUARD_IMPORT}
        const res = await fetch(url, { ...base, method: "POST" });`,
    },
  ],
  invalid: [
    // ---- the finding, exactly: guarded module, no posture --------------
    {
      code: `${GUARD_IMPORT}
        const res = await fetch(url, { method: "POST", body });`,
      errors: [{ messageId: "missingPosture" }],
    },
    // ---- no init argument at all: the default applies verbatim ---------
    {
      code: `${GUARD_IMPORT}
        const res = await fetch(url);`,
      errors: [{ messageId: "missingPosture" }],
    },
    // ---- the skeleton's own shape with the posture deleted -------------
    // This is the exact regression the rule exists to catch.
    {
      code: `${GUARD_IMPORT}
        const init = { method: "POST", body, signal: AbortSignal.timeout(5000) };
        const res = await fetch(target.href, init);`,
      errors: [{ messageId: "missingPosture" }],
    },
    // ---- a dispatcher is guarded-egress evidence on its own ------------
    // No guard import anywhere in the file; the `dispatcher` property alone
    // arms the rule, so an out-of-tree guard is covered too.
    {
      code: `const res = await fetch(url, { method: "POST", dispatcher: agent });`,
      errors: [{ messageId: "missingPosture" }],
    },
    // ---- the post-construction dispatcher attachment -------------------
    // `(init as Record<string, unknown>).dispatcher = agent` compiles down to
    // this assignment; it arms the whole file.
    {
      code: `const init = { method: "POST" };
        init.dispatcher = agent;
        const res = await fetch(url, init);`,
      errors: [{ messageId: "missingPosture" }],
    },
    // ---- globalThis.fetch is the same call ------------------------------
    {
      code: `${GUARD_IMPORT}
        const res = await globalThis.fetch(url, { method: "POST" });`,
      errors: [{ messageId: "missingPosture" }],
    },
  ],
});

describe("require-redirect-posture-on-guarded-fetch", () => {
  it("passes RuleTester", () => {
    expect(true).toBe(true);
  });
});
