import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { listProjectFixtures } from "@repo/api-mocks";
import { ApiProvider } from "@repo/api/react";
import { cs } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";

import { CreateProjectForm } from "./create-project-form";

// Same harness as the list test: MSW (vitest.setup.ts) serves the `projects`
// mock group, including the Idempotency-Key dedupe on POST /v1/projects.
function renderForm() {
  return render(
    <I18nProvider locale="cs" messages={cs}>
      <ApiProvider baseUrl="https://test.local/api">
        <CreateProjectForm />
      </ApiProvider>
    </I18nProvider>,
  );
}

describe("CreateProjectForm", () => {
  it("creates a project through the mock and resets the form on success", async () => {
    renderForm();
    const nameInput = screen.getByLabelText("Název");
    fireEvent.change(nameInput, { target: { value: "Můj projekt" } });
    fireEvent.click(screen.getByRole("button", { name: "Vytvořit projekt" }));

    // Server-side effect: the mock store gained the row (POST 201 succeeded).
    await waitFor(() =>
      expect(listProjectFixtures().some((p) => p.name === "Můj projekt")).toBe(true),
    );
    // onSuccess resets the form.
    await waitFor(() => expect(nameInput).toHaveValue(""));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("blocks an empty name client-side (createProjectSchema via useZodForm)", async () => {
    renderForm();
    const before = listProjectFixtures().length;
    fireEvent.click(screen.getByRole("button", { name: "Vytvořit projekt" }));

    // RHF marks the field invalid from the shared schema — no request fires.
    await waitFor(() => expect(screen.getByLabelText("Název")).toHaveAttribute("aria-invalid"));
    expect(listProjectFixtures().length).toBe(before);
  });
});
