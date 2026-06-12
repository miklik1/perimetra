import { describe, expect, it } from "vitest";

import { cn } from "./utils";

describe("cn", () => {
  it("joins truthy class values and drops falsy ones", () => {
    expect(cn("a", false, null, undefined, "b")).toBe("a b");
  });

  it("resolves conflicting Tailwind utilities last-wins (tailwind-merge)", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("bg-primary", "bg-red-500")).toBe("bg-red-500");
  });

  it("supports conditional (clsx) inputs", () => {
    const active = true;
    expect(cn("text-sm", active && "font-bold")).toBe("text-sm font-bold");
  });
});
