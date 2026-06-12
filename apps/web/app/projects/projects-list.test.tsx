import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { listProjectFixtures } from "@repo/api-mocks";
import { ApiProvider } from "@repo/api/react";
import { cs } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";

import { ProjectsList } from "./projects-list";

// MSW (vitest.setup.ts) serves the same `projects` mock group the BFF serves in
// dev — origin-agnostic patterns, so the placeholder base URL matches. Each
// test starts from the reseeded fixture set (resetProjects in setup afterEach).
function renderList() {
  return render(
    <I18nProvider locale="cs" messages={cs}>
      <ApiProvider baseUrl="https://test.local/api">
        <ProjectsList />
      </ApiProvider>
    </I18nProvider>,
  );
}

describe("ProjectsList", () => {
  it("renders the first page of the keyset-paginated list (newest first)", async () => {
    renderList();
    // Seed set is 25 projects; default limit 20, uuidv7-desc ⇒ newest first.
    expect(await screen.findByText("Project 25")).toBeInTheDocument();
    expect(screen.getByText("Project 6")).toBeInTheDocument();
    expect(screen.queryByText("Project 5")).not.toBeInTheDocument();
    // More pages exist ⇒ the load-more button is enabled with the cs label.
    expect(screen.getByRole("button", { name: "Načíst další" })).toBeEnabled();
  });

  it("fetches the next page via the nextCursor page param", async () => {
    renderList();
    fireEvent.click(await screen.findByRole("button", { name: "Načíst další" }));
    expect(await screen.findByText("Project 1")).toBeInTheDocument();
    // Cursor exhausted ⇒ the button flips to the no-more state and disables.
    expect(screen.getByRole("button", { name: "Žádné další" })).toBeDisabled();
  });

  it("removes a row optimistically on delete", async () => {
    renderList();
    await screen.findByText("Project 25");
    const row = screen.getByText("Project 25").closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: "Smazat" }));
    // Optimistic update: the row disappears without waiting for the server,
    // and stays gone after the settle/invalidate refetch.
    await waitFor(() => expect(screen.queryByText("Project 25")).not.toBeInTheDocument());
    expect(listProjectFixtures().some((p) => p.name === "Project 25")).toBe(false);
  });
});
