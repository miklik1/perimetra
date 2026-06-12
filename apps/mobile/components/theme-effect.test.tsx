import { describe, expect, it, jest } from "@jest/globals";
import { render, waitFor } from "@testing-library/react-native";

import { ThemeEffect } from "./theme-effect";

// expo-splash-screen is a native module — mock it so we can assert the splash is
// dismissed after the theme hydrates. This is the contract that keeps the app
// from hanging on the splash forever: `hideAsync` must run whether hydration
// restored a preference or found none. Names are `mock*` per jest's hoisting rule.
const mockHideAsync = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockPreventAutoHideAsync = jest.fn<() => Promise<boolean>>().mockResolvedValue(true);
jest.mock("expo-splash-screen", () => ({
  preventAutoHideAsync: () => mockPreventAutoHideAsync(),
  hideAsync: () => mockHideAsync(),
}));

describe("ThemeEffect", () => {
  it("hides the splash once theme hydration settles", async () => {
    render(<ThemeEffect />); // renders nothing; mounts the hydrate + reveal effect
    await waitFor(() => expect(mockHideAsync).toHaveBeenCalledTimes(1));
  });
});
