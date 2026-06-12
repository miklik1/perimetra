import { describe, expect, it } from "@jest/globals";
import { renderRouter, screen } from "expo-router/testing-library";

import { ApiProvider } from "@repo/api/react";

import Home from "../app/index";
import Users from "../app/users";

// Route tests live outside `app/` — expo-router treats every file under `app/`
// as a route (it does not ignore `*.test.tsx`), so co-locating here would create
// a phantom `/index.test` route in `expo export`. `renderRouter` mounts an
// in-memory router with an explicit route map (no real `_layout`, so the env
// side-effect in `app/_layout.tsx` is never touched).

// Home now renders <CreateUserForm/>, which reads the QueryClient via
// useUsersQueries/useQueryClient — so the in-memory router needs an ApiProvider
// wrapper (the real app gets it from app/_layout.tsx). baseUrl is a placeholder;
// no request fires from a render.
function ApiWrapper({ children }: { children: React.ReactNode }) {
  return (
    <ApiProvider baseUrl="https://test.local" getToken={() => null}>
      {children}
    </ApiProvider>
  );
}

describe("Home screen", () => {
  it("renders through expo-router with the OS color-scheme readout", async () => {
    renderRouter(
      {
        index: Home,
        // `<Link to={{ route: "users" }}>` resolves to /users — register the
        // real screen so the link target matches the app's route tree.
        users: Users,
      },
      { initialUrl: "/", wrapper: ApiWrapper },
    );

    expect(await screen.findByText("Mobile")).toBeOnTheScreen();
    // useColorScheme() is null under test → the screen falls back to "light".
    expect(screen.getByText("Color scheme: light")).toBeOnTheScreen();
    expect(screen.getByText("Go to users")).toBeOnTheScreen();
    // No FlagsProvider mounted here → `useFlag` reads the static-default value
    // (`example-flag` defaults to `true` in the registry), so the gated demo
    // shows — the flag wiring degrades to registry defaults without a vendor.
    expect(screen.getByText("Flag-gated demo (example-flag)")).toBeOnTheScreen();
  });
});
