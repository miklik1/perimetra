import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { getProjectSiteFixture, listProjectFixtures } from "@repo/api-mocks";
import { ApiProvider } from "@repo/api/react";
import { cs } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";
import { toIsoDate } from "@repo/utils";

import { SaveToProjectPanel } from "./save-to-project-panel";

/**
 * The configurator → project hand-off panel (CAR-13): both the new-project and
 * existing-project flows compose the SAME create/GET-site/PUT-site contracts
 * the mocks now serve (`GET`/`PUT /v1/projects/:id/site`, added alongside this
 * feature), landing on the site route with the appended instance's id. Same
 * MSW harness as `create-project-form.test.tsx`.
 */
const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));

function renderPanel() {
  return render(
    <I18nProvider locale="cs" messages={cs}>
      <ApiProvider baseUrl="https://test.local/api">
        <SaveToProjectPanel
          releaseId="sliding-gate@1"
          productLabel="sliding-gate"
          input={{ opening_width_mm: 4000 }}
        />
      </ApiProvider>
    </I18nProvider>,
  );
}

/** Extract `<projectId>` from a pushed `/site/<projectId>?focus=<instanceId>` URL. */
function projectIdFromPush(): string {
  const url = pushMock.mock.calls.at(-1)?.[0] as string;
  return url.split("/site/")[1]!.split("?")[0]!;
}

describe("SaveToProjectPanel", () => {
  it("defaults the new-project name to the product label + today's date", () => {
    renderPanel();
    expect(screen.getByLabelText("Název projektu")).toHaveValue(
      `sliding-gate ${toIsoDate(new Date())}`,
    );
  });

  it("creates a new project, appends the instance, and lands on its site canvas", async () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText("Název projektu"), {
      target: { value: "Nová zakázka" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Uložit do projektu" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1));
    expect(pushMock).toHaveBeenCalledWith(
      expect.stringMatching(/^\/site\/.+\?focus=sliding-gate-1$/),
    );

    const projectId = projectIdFromPush();
    expect(listProjectFixtures().some((p) => p.id === projectId && p.name === "Nová zakázka")).toBe(
      true,
    );
    const site = getProjectSiteFixture(projectId);
    expect(site.version).toBe(2);
    expect(site.instances).toEqual([
      {
        instanceId: "sliding-gate-1",
        releaseId: "sliding-gate@1",
        input: { opening_width_mm: 4000 },
      },
    ]);
  });

  it("adds to an existing project, showing loading then the seeded list", async () => {
    renderPanel();
    fireEvent.click(screen.getByRole("radio", { name: "Do stávajícího projektu" }));

    // Loading state fires before the mock resolves.
    expect(screen.getByText("Načítání projektů…")).toBeInTheDocument();
    const select = (await screen.findByLabelText("Vyberte projekt")) as HTMLSelectElement;
    // Pick whichever real project the server returned first (its list order,
    // not the raw fixture-array order, is what the select actually renders) —
    // the option right after the "select a project" placeholder.
    const chosenId = (select.options[1] as HTMLOptionElement).value;
    fireEvent.change(select, { target: { value: chosenId } });
    fireEvent.click(screen.getByRole("button", { name: "Uložit do projektu" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1));
    const projectId = projectIdFromPush();
    expect(projectId).toBe(chosenId);
    const site = getProjectSiteFixture(projectId);
    expect(site.version).toBe(2);
    expect(site.instances).toHaveLength(1);
  });

  it("disables the submit button until a valid choice is made", async () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText("Název projektu"), { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Uložit do projektu" })).toBeDisabled();

    fireEvent.click(screen.getByRole("radio", { name: "Do stávajícího projektu" }));
    expect(screen.getByRole("button", { name: "Uložit do projektu" })).toBeDisabled();
    await screen.findByLabelText("Vyberte projekt");
    expect(screen.getByRole("button", { name: "Uložit do projektu" })).toBeDisabled();
  });
});
