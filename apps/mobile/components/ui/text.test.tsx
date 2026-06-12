import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";

import { Text } from "./text";

// NativeWind's className→style transform runs in Metro, not Jest, so styles
// aren't applied here — asserting className strings would only mirror the
// source. Styling is verified by the device smoke-test (ADR 0001). These cover
// rendering + that the variant prop doesn't break it.
describe("Text", () => {
  it("renders its children", () => {
    render(<Text>Hello</Text>);
    expect(screen.getByText("Hello")).toBeOnTheScreen();
  });

  it("renders with a non-default variant", () => {
    render(<Text variant="heading">Title</Text>);
    expect(screen.getByText("Title")).toBeOnTheScreen();
  });
});
