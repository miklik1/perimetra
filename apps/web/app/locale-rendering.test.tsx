import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { cs, en } from "@repo/i18n";
import { I18nProvider, useTranslations } from "@repo/i18n/web";

// A minimal "use client" leaf that reads a translation, exercising the same
// `useTranslations` path every client surface uses.
function Label() {
  const t = useTranslations("locale");
  return <span>{t("cs")}</span>;
}

describe("client translations (I18nProvider)", () => {
  it("renders the Czech catalog under locale=cs", () => {
    render(
      <I18nProvider locale="cs" messages={cs}>
        <Label />
      </I18nProvider>,
    );
    expect(screen.getByText("Čeština")).toBeInTheDocument();
  });

  it("flips to the English catalog under locale=en", () => {
    render(
      <I18nProvider locale="en" messages={en}>
        <Label />
      </I18nProvider>,
    );
    expect(screen.getByText("Czech")).toBeInTheDocument();
  });
});
