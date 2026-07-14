import { describe, expect, it } from "vitest";

import { projectQuoteOverrides } from "./deviation-projection.js";

const NOW = "2026-01-01T00:00:00.000Z";
const ovr = (target: string, value: unknown, reason?: string) => ({
  id: `ovr-${target}`,
  scope: "quote" as const,
  scopeRef: "q1",
  target,
  value: value as never,
  author: "u1",
  ...(reason !== undefined && { reason }),
  createdAt: NOW,
});

describe("projectQuoteOverrides — quote-scope overrides → ledger rows (ADR 0110)", () => {
  it("projects one row per quote-scope override, tagging kind from the target", () => {
    const rows = projectQuoteOverrides("q1", {
      inputs: {
        gate: {
          overrides: {
            quote: [ovr("param:width", 3200, "custom width"), ovr("price:GATE-01", "999")],
          },
        },
        fence: { overrides: { quote: [ovr("artifact:frame.lprofile.quantity", 4)] } },
      },
    });

    expect(rows).toHaveLength(3);
    expect(rows.map((r) => [r.source, r.kind, r.target])).toEqual([
      ["quote_override", "param", "param:width"],
      ["quote_override", "price", "price:GATE-01"],
      ["quote_override", "artifact", "artifact:frame.lprofile.quantity"],
    ]);
    expect(rows[0]?.reason).toBe("custom width");
    expect(rows[1]?.reason).toBe(""); // no reason → empty string, never undefined
    expect(rows.every((r) => r.quoteId === "q1")).toBe(true);
  });

  it("returns nothing for a snapshot with no quote-scope overrides (the golden case)", () => {
    expect(projectQuoteOverrides("q1", { inputs: { gate: {} } })).toEqual([]);
    expect(projectQuoteOverrides("q1", { inputs: { gate: { overrides: {} } } })).toEqual([]);
  });
});
