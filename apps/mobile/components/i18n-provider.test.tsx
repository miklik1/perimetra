import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";

import { cs, en } from "@repo/i18n";
import { I18nProvider, useTranslations } from "@repo/i18n/native";

// use-intl/React Native de-risk (ADR 0020; next-intl#957). If use-intl's
// IntlProvider + useTranslations ever break under the RN/Jest toolchain, this is
// the first guard — the documented fallback is Lingui behind the same surface.
function Label() {
  const t = useTranslations("locale");
  return <Text>{t("cs")}</Text>;
}

describe("i18n (use-intl on React Native)", () => {
  it("renders the cs catalog via IntlProvider + useTranslations", () => {
    render(
      <I18nProvider locale="cs" messages={cs}>
        <Label />
      </I18nProvider>,
    );
    expect(screen.getByText("Čeština")).toBeOnTheScreen();
  });

  it("flips to the en catalog", () => {
    render(
      <I18nProvider locale="en" messages={en}>
        <Label />
      </I18nProvider>,
    );
    expect(screen.getByText("Czech")).toBeOnTheScreen();
  });
});
