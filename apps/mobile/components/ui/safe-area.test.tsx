import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";

import { SafeArea } from "./safe-area";
import { Text } from "./text";

// Renders via react-native-safe-area-context's SafeAreaView using the library's
// jest mock (registered in jest/setup.ts) — no live <SafeAreaProvider> needed.
describe("SafeArea", () => {
  it("renders its children", () => {
    render(
      <SafeArea className="bg-background flex-1">
        <Text>Inside</Text>
      </SafeArea>,
    );
    expect(screen.getByText("Inside")).toBeOnTheScreen();
  });
});
