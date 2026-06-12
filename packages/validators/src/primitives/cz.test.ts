import { describe, expect, it } from "vitest";

import { bankAccount, dic, iban, ico, psc, rodneCislo } from "./cz";

describe("ico", () => {
  it("accepts IČO with a valid mod-11 check digit", () => {
    expect(ico.safeParse("00027383").success).toBe(true); // remainder branch 11−r
    expect(ico.safeParse("27082440").success).toBe(true); // remainder 1 → check 0
  });

  it("rejects a wrong check digit and bad shapes", () => {
    expect(ico.safeParse("27082441").success).toBe(false);
    expect(ico.safeParse("1234567").success).toBe(false);
    expect(ico.safeParse("123456789").success).toBe(false);
  });
});

describe("dic", () => {
  it("accepts CZ + 8–10 digits", () => {
    expect(dic.safeParse("CZ27082440").success).toBe(true);
    expect(dic.safeParse("CZ1234567890").success).toBe(true);
  });

  it("rejects other prefixes and lengths", () => {
    expect(dic.safeParse("SK27082440").success).toBe(false);
    expect(dic.safeParse("CZ1234567").success).toBe(false);
  });
});

describe("psc", () => {
  it("accepts NNN NN with the space optional", () => {
    expect(psc.safeParse("110 00").success).toBe(true);
    expect(psc.safeParse("11000").success).toBe(true);
  });

  it("rejects other shapes", () => {
    expect(psc.safeParse("1100").success).toBe(false);
    expect(psc.safeParse("110-00").success).toBe(false);
  });
});

describe("bankAccount", () => {
  it("accepts checksum-valid accounts with and without a prefix", () => {
    expect(bankAccount.safeParse("19-2000145399/0800").success).toBe(true);
    expect(bankAccount.safeParse("2000145399/0800").success).toBe(true);
  });

  it("rejects a failed number or prefix checksum", () => {
    expect(bankAccount.safeParse("19-2000145398/0800").success).toBe(false);
    expect(bankAccount.safeParse("18-2000145399/0800").success).toBe(false);
  });

  it("rejects malformed shapes", () => {
    expect(bankAccount.safeParse("2000145399/080").success).toBe(false);
    expect(bankAccount.safeParse("2000145399").success).toBe(false);
  });
});

describe("iban", () => {
  it("accepts a mod-97-valid Czech IBAN", () => {
    expect(iban.safeParse("CZ6508000000192000145399").success).toBe(true);
  });

  it("rejects wrong check digits, countries and lengths", () => {
    expect(iban.safeParse("CZ6608000000192000145399").success).toBe(false);
    expect(iban.safeParse("SK6508000000192000145399").success).toBe(false);
    expect(iban.safeParse("CZ65080000001920001453").success).toBe(false);
  });
});

describe("rodneCislo", () => {
  it("accepts checksum-valid ten-digit numbers (slash optional)", () => {
    expect(rodneCislo.safeParse("900720/0004").success).toBe(true); // male month
    expect(rodneCislo.safeParse("905720/0009").success).toBe(true); // +50 female month
    expect(rodneCislo.safeParse("9007200004").success).toBe(true);
  });

  it("accepts the historical remainder-10 exception (trailing zero)", () => {
    expect(rodneCislo.safeParse("540101/1120").success).toBe(true);
  });

  it("accepts pre-1954 nine-digit numbers without a checksum", () => {
    expect(rodneCislo.safeParse("530101/123").success).toBe(true);
    expect(rodneCislo.safeParse("530101123").success).toBe(true);
  });

  it("rejects failed checksums", () => {
    expect(rodneCislo.safeParse("900720/0005").success).toBe(false);
    expect(rodneCislo.safeParse("540101/1130").success).toBe(false);
  });

  it("rejects out-of-window months, bad days and post-1953 nine-digit numbers", () => {
    expect(rodneCislo.safeParse("901520/0004").success).toBe(false); // month 15
    expect(rodneCislo.safeParse("900700/0008").success).toBe(false); // day 00
    expect(rodneCislo.safeParse("600101/123").success).toBe(false); // 9 digits, YY ≥ 54
  });

  it("rejects calendar-impossible days even with a valid checksum", () => {
    expect(rodneCislo.safeParse("900231/0009").success).toBe(false); // Feb 31, 1990
    expect(rodneCislo.safeParse("900431/0007").success).toBe(false); // Apr 31, 1990
  });

  it("handles leap years via the unambiguous encoded century", () => {
    expect(rodneCislo.safeParse("000229/0002").success).toBe(true); // Feb 29, 2000 (leap)
    expect(rodneCislo.safeParse("010229/0001").success).toBe(false); // Feb 29, 2001 (not)
  });
});
