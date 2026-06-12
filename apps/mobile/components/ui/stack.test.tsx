import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";

import { Stack } from "./stack";
import { Text } from "./text";

// The gap → utility mapping is covered by styles.test.ts; className isn't
// applied under Jest (NativeWind runs in Metro). This is a render smoke test.
describe("Stack", () => {
  it("renders its children", () => {
    render(
      <Stack gap={6}>
        <Text>Child</Text>
      </Stack>,
    );
    expect(screen.getByText("Child")).toBeOnTheScreen();
  });
});
