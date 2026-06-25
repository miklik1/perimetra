import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ApiProvider } from "@repo/api/react";
import { cs } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";

import { Editor } from "./release-editor";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

// The inner editor (auth gate covered separately). i18n + ApiProvider (which
// carries the query client) are the only context it needs.
function renderEditor() {
  return render(
    <I18nProvider locale="cs" messages={cs}>
      <ApiProvider baseUrl="https://test.local/api">
        <Editor />
      </ApiProvider>
    </I18nProvider>,
  );
}

describe("ReleaseEditor", () => {
  it("renders the three-region shell with Publish blocked on an empty draft", () => {
    renderEditor();
    expect(screen.getByRole("heading", { name: cs.releaseEditor.title })).toBeInTheDocument();
    // No modelId yet → Publish disabled.
    expect(screen.getByRole("button", { name: cs.releaseEditor.publish })).toBeDisabled();
  });

  it("navigates to the parameters workbench and adds a row", () => {
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: cs.releaseEditor.section_parameters }));
    expect(screen.getByText(cs.releaseEditor.parametersEmpty)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: cs.releaseEditor.addParameter }));
    // A row appeared → its Key field label is present.
    expect(screen.getAllByText(cs.releaseEditor.key).length).toBeGreaterThan(0);
  });

  it("navigates to the parts workbench and adds a part (open by default)", () => {
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: cs.releaseEditor.section_parts }));
    expect(screen.getByText(cs.releaseEditor.partsEmpty)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: cs.releaseEditor.addPart }));
    // A new (empty-path) part renders open → its Path field label is present.
    expect(screen.getAllByText(cs.releaseEditor.partPath).length).toBeGreaterThan(0);
  });
});
