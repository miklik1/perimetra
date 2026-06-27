import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { cs } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";
import { type AresLookup } from "@repo/validators";

import { aresPrefill, ViesBadge, viesTone } from "./registry-lookup";

/**
 * Registry-lookup helper proof (ADR 0090): the ARES→prefill mapping (found only),
 * the VIES tone selection, and that the badge renders the correct localized
 * label per status (and nothing before a lookup). Backend fail-soft lives in the
 * api's lookups.service.test.ts.
 */
function ui(node: ReactNode) {
  return render(
    <I18nProvider locale="cs" messages={cs}>
      {node}
    </I18nProvider>,
  );
}

describe("aresPrefill", () => {
  it("maps a found subject to prefillable fields", () => {
    const found: AresLookup = {
      status: "found",
      ico: "26060469",
      name: "ASD Software, s.r.o.",
      dic: "CZ26060469",
      address: { line: "Žerotínova 2981/55a", city: "Šumperk", postalCode: "78701", country: "CZ" },
      dissolved: false,
    };
    expect(aresPrefill(found)).toStrictEqual({
      name: "ASD Software, s.r.o.",
      dic: "CZ26060469",
      addressLine: "Žerotínova 2981/55a",
      city: "Šumperk",
      postalCode: "78701",
      country: "CZ",
    });
  });

  it("returns null for a degraded (not_found / unavailable) result", () => {
    expect(aresPrefill({ status: "not_found" })).toBeNull();
    expect(aresPrefill({ status: "unavailable" })).toBeNull();
  });
});

describe("viesTone", () => {
  it("prefers loading, then the result status, then null", () => {
    expect(viesTone(undefined, true)).toBe("loading");
    expect(viesTone({ status: "valid" }, false)).toBe("valid");
    expect(viesTone({ status: "invalid" }, false)).toBe("invalid");
    expect(viesTone({ status: "unavailable" }, false)).toBe("unavailable");
    expect(viesTone(undefined, false)).toBeNull();
  });
});

describe("ViesBadge", () => {
  it("renders nothing before a lookup", () => {
    const { container } = ui(<ViesBadge />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the valid label", () => {
    ui(<ViesBadge result={{ status: "valid" }} />);
    expect(screen.getByRole("status")).toHaveTextContent("DIČ ověřeno v systému VIES");
  });

  it("shows the invalid label", () => {
    ui(<ViesBadge result={{ status: "invalid" }} />);
    expect(screen.getByRole("status")).toHaveTextContent("DIČ není platné (VIES)");
  });

  it("shows unavailable distinctly from invalid", () => {
    ui(<ViesBadge result={{ status: "unavailable" }} />);
    expect(screen.getByRole("status")).toHaveTextContent("nelze ověřit");
  });

  it("shows the checking label while loading", () => {
    ui(<ViesBadge loading />);
    expect(screen.getByRole("status")).toHaveTextContent("Ověřuji DIČ…");
  });
});
