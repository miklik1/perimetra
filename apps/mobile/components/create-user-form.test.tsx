import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";

import { ApiProvider } from "@repo/api/react";

import { CreateUserForm } from "./create-user-form";

// Render smoke test: the RHF + Controller wiring mounts and the fields show.
// Validation/mutation behaviour (the shared schema + create mutation) is unit-
// tested in @repo/validators and @repo/api; styling is device-verified (ADR 0001).
// ApiProvider supplies the QueryClient the form's useMutation/useQueryClient need.
describe("CreateUserForm", () => {
  it("renders the name + email fields and the submit button", () => {
    render(
      <ApiProvider baseUrl="https://test.local" getToken={() => null}>
        <CreateUserForm />
      </ApiProvider>,
    );

    expect(screen.getByPlaceholderText("Name")).toBeOnTheScreen();
    expect(screen.getByPlaceholderText("Email")).toBeOnTheScreen();
    expect(screen.getByText("Create user")).toBeOnTheScreen();
  });
});
