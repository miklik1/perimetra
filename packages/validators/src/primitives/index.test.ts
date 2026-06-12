import { describe, expect, it } from "vitest";

import { money, password, phoneE164, positiveInt, slug, url } from "./index";

describe("password", () => {
  it("accepts a compliant password", () => {
    expect(password.safeParse("Abcdef12").success).toBe(true);
  });

  it("rejects missing complexity classes and bad lengths", () => {
    expect(password.safeParse("abcdef12").success).toBe(false); // no uppercase
    expect(password.safeParse("ABCDEF12").success).toBe(false); // no lowercase
    expect(password.safeParse("Abcdefgh").success).toBe(false); // no digit
    expect(password.safeParse("Ab1").success).toBe(false); // too short
    expect(password.safeParse(`A1${"a".repeat(127)}`).success).toBe(false); // too long
  });
});

describe("phoneE164", () => {
  it("accepts E.164 and rejects local formats", () => {
    expect(phoneE164.safeParse("+420123456789").success).toBe(true);
    expect(phoneE164.safeParse("123 456 789").success).toBe(false);
    expect(phoneE164.safeParse("00420123456789").success).toBe(false);
  });
});

describe("url", () => {
  it("accepts absolute URLs and rejects fragments", () => {
    expect(url.safeParse("https://example.com/a?b=1").success).toBe(true);
    expect(url.safeParse("not-a-url").success).toBe(false);
  });
});

describe("slug", () => {
  it("accepts dash-separated lowercase alphanumerics", () => {
    expect(slug.safeParse("hello-world-42").success).toBe(true);
  });

  it("rejects uppercase, doubled or leading/trailing dashes", () => {
    expect(slug.safeParse("Hello").success).toBe(false);
    expect(slug.safeParse("a--b").success).toBe(false);
    expect(slug.safeParse("-a").success).toBe(false);
    expect(slug.safeParse("a-").success).toBe(false);
  });
});

describe("positiveInt", () => {
  it("accepts positive integers only", () => {
    expect(positiveInt.safeParse(1).success).toBe(true);
    expect(positiveInt.safeParse(0).success).toBe(false);
    expect(positiveInt.safeParse(-1).success).toBe(false);
    expect(positiveInt.safeParse(1.5).success).toBe(false);
  });
});

describe("money", () => {
  it("accepts non-negative amounts with ≤2 decimal places", () => {
    expect(money.safeParse(0).success).toBe(true);
    expect(money.safeParse(10.25).success).toBe(true);
    expect(money.safeParse(0.1).success).toBe(true);
  });

  it("rejects negatives and sub-cent precision", () => {
    expect(money.safeParse(-1).success).toBe(false);
    expect(money.safeParse(10.255).success).toBe(false);
  });
});
