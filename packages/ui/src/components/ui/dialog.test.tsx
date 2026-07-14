import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  Sheet,
  SheetContent,
} from "./dialog";

describe("Dialog", () => {
  it("opens a titled, floating chrome modal from its trigger", () => {
    render(
      <Dialog>
        <DialogTrigger>Otevřít</DialogTrigger>
        <DialogContent>
          <DialogTitle>Upravit položku</DialogTitle>
          <DialogDescription>Změň rozměr brány.</DialogDescription>
        </DialogContent>
      </Dialog>,
    );
    // Closed: radix mounts the content only on open.
    expect(screen.queryByText("Upravit položku")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Otevřít" }));

    expect(screen.getByText("Upravit položku")).toBeInTheDocument();
    // Brand token: the centered surface is a floating matte-chrome card.
    const content = screen.getByRole("dialog");
    expect(content.className).toContain("rounded-card");
    expect(content.className).toContain("shadow-float");
    expect(content).toHaveAttribute("data-slot", "dialog-content");
  });

  it("dismisses again through a DialogClose control", () => {
    render(
      <Dialog defaultOpen>
        <DialogContent>
          <DialogTitle>Nastavení odchylky</DialogTitle>
          <DialogClose>Zavřít</DialogClose>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByText("Nastavení odchylky")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Zavřít" }));
    expect(screen.queryByText("Nastavení odchylky")).not.toBeInTheDocument();
  });

  it("throws a clear error when DialogContent is used with no root", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      render(
        <DialogContent>
          <DialogTitle>x</DialogTitle>
        </DialogContent>,
      ),
    ).toThrow(/inside <Dialog>/);
    spy.mockRestore();
  });
});

describe("Sheet", () => {
  it("anchors the panel to the requested edge over the shared chrome surface", () => {
    render(
      <Sheet defaultOpen>
        <SheetContent side="left">
          <DialogTitle>Filtry</DialogTitle>
        </SheetContent>
      </Sheet>,
    );
    const panel = screen.getByRole("dialog");
    expect(screen.getByText("Filtry")).toBeInTheDocument();
    expect(panel.className).toContain("left-0");
    expect(panel.className).toContain("bg-chrome");
    expect(panel).toHaveAttribute("data-side", "left");
  });

  it("rejects a SheetContent placed under a Dialog root", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      render(
        <Dialog defaultOpen>
          <SheetContent>
            <DialogTitle>x</DialogTitle>
          </SheetContent>
        </Dialog>,
      ),
    ).toThrow(/inside <Sheet>/);
    spy.mockRestore();
  });
});
