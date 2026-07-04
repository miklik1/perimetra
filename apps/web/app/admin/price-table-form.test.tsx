import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ApiProvider } from "@repo/api/react";
import { cs } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";

import { PriceTableForm } from "./price-table-form";

/** i18n + `ApiProvider` (query client) are the only context this form needs —
 *  it never hits the network in these tests (either nothing is submitted, or
 *  the duplicate-code guard returns before `mutation.mutate` is called). */
function renderForm(componentCodes: string[] = []) {
  return render(
    <I18nProvider locale="cs" messages={cs}>
      <ApiProvider baseUrl="https://test.local/api">
        <PriceTableForm componentCodes={componentCodes} />
      </ApiProvider>
    </I18nProvider>,
  );
}

function fillRequiredScalars() {
  fireEvent.change(screen.getByLabelText(cs.admin.effectiveFrom), {
    target: { value: "2026-01-01T00:00" },
  });
  fireEvent.change(screen.getByLabelText(cs.admin.manufacturingRate), {
    target: { value: "790" },
  });
  fireEvent.change(screen.getByLabelText(cs.admin.manufacturingMultiplier), {
    target: { value: "16" },
  });
  fireEvent.change(screen.getByLabelText(cs.admin.installation), {
    target: { value: "10500" },
  });
}

describe("PriceTableForm (CAR-15)", () => {
  it("starts with no component rows and an empty-state message", () => {
    renderForm();
    expect(screen.getByText(cs.admin.componentsEmpty)).toBeInTheDocument();
  });

  it("adding a component row exposes code/price/cost fields", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: cs.admin.addComponent }));
    expect(screen.getByLabelText(cs.admin.componentCode)).toBeInTheDocument();
    expect(screen.getByLabelText(cs.admin.sellPrice)).toBeInTheDocument();
    expect(screen.getByLabelText(cs.admin.costPrice)).toBeInTheDocument();
  });

  it("hides the cost-table fields until 'include a cost table' is checked", () => {
    renderForm();
    expect(screen.queryByLabelText(cs.admin.costManufacturingRate)).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(cs.admin.hasCost));
    expect(screen.getByLabelText(cs.admin.costManufacturingRate)).toBeInTheDocument();
    expect(screen.getByLabelText(cs.admin.costManufacturingMultiplier)).toBeInTheDocument();
    expect(screen.getByLabelText(cs.admin.costInstallation)).toBeInTheDocument();
  });

  it("suggests catalog component codes via a datalist, degrading to none when empty", () => {
    const { container, rerender } = render(
      <I18nProvider locale="cs" messages={cs}>
        <ApiProvider baseUrl="https://test.local/api">
          <PriceTableForm componentCodes={["sloupek_l_50", "tower_post"]} />
        </ApiProvider>
      </I18nProvider>,
    );
    const options = [...container.querySelectorAll("datalist option")].map((o) =>
      o.getAttribute("value"),
    );
    expect(options).toEqual(["sloupek_l_50", "tower_post"]);

    rerender(
      <I18nProvider locale="cs" messages={cs}>
        <ApiProvider baseUrl="https://test.local/api">
          <PriceTableForm componentCodes={[]} />
        </ApiProvider>
      </I18nProvider>,
    );
    expect(container.querySelector("datalist")).not.toBeInTheDocument();
  });

  it("blocks submit on a duplicate component code without touching the network", async () => {
    renderForm();
    fillRequiredScalars();
    fireEvent.click(screen.getByRole("button", { name: cs.admin.addComponent }));
    fireEvent.click(screen.getByRole("button", { name: cs.admin.addComponent }));
    const codeInputs = screen.getAllByLabelText(cs.admin.componentCode);
    fireEvent.change(codeInputs[0]!, { target: { value: "a" } });
    fireEvent.change(codeInputs[1]!, { target: { value: "a" } });

    fireEvent.click(screen.getByRole("button", { name: cs.admin.publish }));

    await waitFor(() => {
      expect(
        screen.getByText(cs.admin.duplicateComponentCode.replace("{codes}", "a")),
      ).toBeInTheDocument();
    });
  });

  it("shows a field-level error instead of a JSON.parse exception on a bad bulk-JSON paste", () => {
    const { container } = renderForm();
    fireEvent.click(screen.getByRole("button", { name: cs.admin.bulkJsonSection }));
    // The bulk-JSON textarea is the form's only <textarea> — grab it directly
    // rather than by accessible name (it's a bare `<textarea>`, not wrapped in
    // `FieldShell`, since it mirrors live form state rather than being one).
    const bulkJsonTextarea = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(bulkJsonTextarea).toBeTruthy();
    fireEvent.change(bulkJsonTextarea, { target: { value: "{not json" } });
    fireEvent.click(screen.getByRole("button", { name: cs.admin.applyJson }));
    expect(screen.getByText(cs.admin.jsonParseError)).toBeInTheDocument();
  });
});
