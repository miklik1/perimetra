import { describe, expect, it } from "vitest";

import { contentDispositionHeader } from "./storage.service.js";

describe("contentDispositionHeader", () => {
  it("leaves a plain ASCII filename unchanged in both forms", () => {
    expect(contentDispositionHeader("report.pdf")).toBe(
      `attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`,
    );
  });

  it("round-trips a Czech diacritics filename via the RFC 5987 extended value", () => {
    const filename = "faktura-přehled-2026-šňůra.pdf";
    const header = contentDispositionHeader(filename);

    const encoded = header.split(`filename*=UTF-8''`)[1] ?? "";
    expect(decodeURIComponent(encoded)).toBe(filename);
    // The whole header is ASCII-safe — no raw multi-byte chars leak into it.
    expect(header).toMatch(/^[\x20-\x7e]*$/);
  });

  it("neutralizes a double-quote breakout attempt in the ASCII fallback", () => {
    const header = contentDispositionHeader('evil".pdf');
    // The quote survives only backslash-escaped — the quoted-string can't
    // close early and start a second (attacker-controlled) parameter.
    expect(header).toBe(`attachment; filename="evil\\".pdf"; filename*=UTF-8''evil%22.pdf`);
  });

  it("escapes a literal backslash before escaping the quote it precedes", () => {
    // Raw filename contains a backslash immediately followed by a double
    // quote — escaping the quote first (without first doubling the
    // backslash) would let the backslash "consume" the escape and
    // un-escape the quote again.
    const header = contentDispositionHeader('evil\\".pdf');
    expect(header).toBe(`attachment; filename="evil\\\\\\".pdf"; filename*=UTF-8''evil%5C%22.pdf`);
  });

  it("strips CR/LF so a filename can't inject a second header", () => {
    const header = contentDispositionHeader("evil.pdf\r\nX-Injected: true");
    expect(header).not.toMatch(/[\r\n]/);
    expect(header).toBe(
      `attachment; filename="evil.pdfX-Injected: true"; filename*=UTF-8''evil.pdfX-Injected%3A%20true`,
    );
  });

  it("keeps a semicolon inside the quoted string instead of starting a new parameter", () => {
    const header = contentDispositionHeader("a; b.pdf");
    expect(header).toBe(`attachment; filename="a; b.pdf"; filename*=UTF-8''a%3B%20b.pdf`);
    // Exactly the two Content-Disposition params this function ever emits —
    // the semicolon in the name didn't add a third.
    expect(header.split("filename=").length - 1).toBe(1);
    expect(header.split("filename*=").length - 1).toBe(1);
  });
});
