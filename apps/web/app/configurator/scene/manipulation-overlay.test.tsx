import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { cs } from "@repo/i18n";
import { I18nProvider } from "@repo/i18n/web";
import type { Scene3D } from "@repo/renderers";

import { deriveForUi } from "../derive";
import { goldenCatalogs, goldenPricing, goldenProducts } from "../golden-bundle";
import { selectionKeyOf, useManipulation, type ManipulationBridge } from "./manipulation";
import { ManipulationOverlay } from "./manipulation-overlay";
import { makeOverlayRefs } from "./manipulation-rig";

/**
 * The immersive overlay's DOM behaviour (ADR 0116, §7.6). The continuous drag
 * is a pointer + rAF gesture jsdom cannot drive faithfully, so it is proven by
 * eyes-on and the adversarial pass; this suite covers the deterministic paths:
 * the pill editor, the keyboard-operable handles, and the selection chip — all
 * writing the SAME parameter the form field would, and all clamping to the
 * range domain.
 */
const gate = goldenProducts[0]!;
const scene: Scene3D = deriveForUi(gate, gate.initialInput, goldenPricing, goldenCatalogs).scene!;

const WIDTH = {
  key: "opening_width_mm",
  label: "Šířka otvoru",
  value: 4000,
  min: 2000,
  max: 8000,
  step: 10,
};

let commit: Mock<(key: string, value: number) => void>;
let preview: Mock<(key: string, value: number) => void>;

function setBridge(over: Partial<Pick<ManipulationBridge, "width" | "height">> = {}) {
  commit = vi.fn<(key: string, value: number) => void>();
  preview = vi.fn<(key: string, value: number) => void>();
  useManipulation.setState({
    bridge: { width: WIDTH, height: null, commit, preview, ...over },
  });
}

function renderOverlay() {
  return render(
    <I18nProvider locale="cs" messages={cs}>
      <ManipulationOverlay refs={makeOverlayRefs()} scene={scene} />
    </I18nProvider>,
  );
}

beforeEach(() => {
  useManipulation.setState({ selected: null, drag: null });
  setBridge();
});
afterEach(() => {
  useManipulation.setState({ bridge: null });
});

describe("ManipulationOverlay handles", () => {
  it("renders four corner handles for a bound width", () => {
    renderOverlay();
    const label = cs.configurator.resizeHandle.replace("{dimension}", WIDTH.label);
    expect(screen.getAllByRole("button", { name: label })).toHaveLength(4);
  });

  it("nudges by the domain step on ArrowRight — previews on keydown, commits once on keyup", () => {
    renderOverlay();
    const label = cs.configurator.resizeHandle.replace("{dimension}", WIDTH.label);
    const handle = screen.getAllByRole("button", { name: label })[0]!;
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(preview).toHaveBeenCalledWith("opening_width_mm", 4010);
    expect(commit).not.toHaveBeenCalled();
    fireEvent.keyUp(handle, { key: "ArrowRight" });
    expect(commit).toHaveBeenCalledWith("opening_width_mm", 4010);
  });

  it("accumulates held repeats locally and commits the final value once (no debounce stall)", () => {
    renderOverlay();
    const label = cs.configurator.resizeHandle.replace("{dimension}", WIDTH.label);
    const handle = screen.getAllByRole("button", { name: label })[0]!;
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    fireEvent.keyDown(handle, { key: "ArrowRight" }); // OS key-repeat — binding.value has not changed
    fireEvent.keyUp(handle, { key: "ArrowRight" });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith("opening_width_mm", 4020);
  });

  it("shows nothing for a dimension the release does not bind", () => {
    setBridge({ width: null });
    renderOverlay();
    const label = cs.configurator.resizeHandle.replace("{dimension}", WIDTH.label);
    expect(screen.queryByRole("button", { name: label })).toBeNull();
  });
});

describe("ManipulationOverlay pill", () => {
  it("edits the same parameter and clamps to the domain on submit", () => {
    renderOverlay();
    const label = cs.configurator.editDimension.replace("{dimension}", WIDTH.label);
    fireEvent.click(screen.getByRole("button", { name: label }));
    const input = screen.getByRole("textbox", { name: WIDTH.label });
    fireEvent.change(input, { target: { value: "9000" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(commit).toHaveBeenCalledWith("opening_width_mm", 8000);
  });

  it("returns focus to the trigger after a keyboard commit (never drops to <body>)", () => {
    renderOverlay();
    const label = cs.configurator.editDimension.replace("{dimension}", WIDTH.label);
    fireEvent.click(screen.getByRole("button", { name: label }));
    const input = screen.getByRole("textbox", { name: WIDTH.label });
    fireEvent.change(input, { target: { value: "5000" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("button", { name: label })).toHaveFocus();
  });
});

describe("ManipulationOverlay selection chip", () => {
  it("names the picked part and clears it", () => {
    const piece = scene.instances[0]!.pieces[0]!;
    useManipulation.setState({ selected: selectionKeyOf(piece.id) });
    renderOverlay();
    expect(screen.getByText(piece.name)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: cs.configurator.clearSelection }));
    expect(useManipulation.getState().selected).toBeNull();
  });

  it("shows no chip with nothing selected", () => {
    renderOverlay();
    expect(screen.queryByRole("button", { name: cs.configurator.clearSelection })).toBeNull();
  });
});
