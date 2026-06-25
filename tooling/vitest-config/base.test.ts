// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guard the CPU-contention timeout raise (Engineering finding: "web/api vitest
 * suites flake under CPU contention"). `turbo run test` fans ~14 suites out at
 * once; the 5s vitest default (`testTimeout`/`hookTimeout`) and the 1s RTL
 * `asyncUtilTimeout` default then trip an otherwise-passing test — a different
 * suite each run. A static-source read (no module/DOM edge — same technique as
 * the eslint base.test.ts guard) pins the values so a silent revert fails here.
 */
const baseSrc = readFileSync(fileURLToPath(new URL("./base.ts", import.meta.url)), "utf8");
const reactSetupSrc = readFileSync(
  fileURLToPath(new URL("./setup/react.ts", import.meta.url)),
  "utf8",
);

describe("vitest-config — CPU-contention timeouts", () => {
  it("base raises testTimeout and hookTimeout to 30s", () => {
    expect(baseSrc).toMatch(/testTimeout:\s*30_000/);
    expect(baseSrc).toMatch(/hookTimeout:\s*30_000/);
  });

  it("the react setup raises RTL asyncUtilTimeout to 15s", () => {
    expect(reactSetupSrc).toMatch(/asyncUtilTimeout:\s*15_000/);
  });
});
