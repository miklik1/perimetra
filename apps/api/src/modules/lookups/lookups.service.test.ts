/**
 * Registry-lookup service unit test (ADR 0090). The api has NO 3rd-party-HTTP
 * test harness, so the upstreams are mocked with `vi.spyOn(global, "fetch")`.
 * Pins the FAIL-SOFT contract (outage/timeout/parse → `unavailable`, never an
 * exception), the ARES field mapping + address fallback, the VIES
 * invalid-vs-inconclusive distinction, the malformed-key 400 (no upstream call),
 * the request URLs, and that the IČO/DIČ never reach a log line.
 */
import { BadRequestException, Logger } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type Env } from "../../common/config/env.js";
import { LookupsService } from "./lookups.service.js";

const ENV = {
  ARES_BASE_URL: "https://ares.test/rest",
  VIES_BASE_URL: "https://vies.test",
} as Env;

// IČO with a valid mod-11 check digit (the ARES example subject); CZ + it is a
// well-formed DIČ.
const ICO = "26060469";
const DIC = "CZ26060469";

const service = () => new LookupsService(ENV);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LookupsService.lookupAres", () => {
  it("maps a found subject to name/dic/address and flags an active subject", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(
      jsonResponse({
        obchodniJmeno: "ASD Software, s.r.o.",
        dic: "CZ26060469",
        datumZaniku: null,
        sidlo: {
          nazevUlice: "Žerotínova",
          cisloDomovni: 2981,
          cisloOrientacni: "55a",
          nazevObce: "Šumperk",
          psc: 78701,
        },
      }),
    );

    const result = await service().lookupAres(ICO);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://ares.test/rest/ekonomicke-subjekty/26060469");
    expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
    expect(result).toStrictEqual({
      status: "found",
      ico: "26060469",
      name: "ASD Software, s.r.o.",
      dic: "CZ26060469",
      address: {
        line: "Žerotínova 2981/55a",
        city: "Šumperk",
        postalCode: "78701",
        country: "CZ",
      },
      dissolved: false,
    });
  });

  it("flags a dissolved subject (datumZaniku present)", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      jsonResponse({ obchodniJmeno: "Zaniklá s.r.o.", datumZaniku: "2020-01-01" }),
    );
    const result = await service().lookupAres(ICO);
    expect(result).toMatchObject({ status: "found", dissolved: true });
  });

  it("falls back to the city part / textová adresa when there is no street", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      jsonResponse({
        obchodniJmeno: "Vesnička s.r.o.",
        sidlo: { nazevCastiObce: "Dolní Lhota", nazevObce: "Lhota", psc: 12345 },
      }),
    );
    const result = await service().lookupAres(ICO);
    expect(result).toMatchObject({
      status: "found",
      address: { line: "Dolní Lhota", city: "Lhota", postalCode: "12345", country: "CZ" },
    });
  });

  it("returns not_found on a 404 (a definite no-such-subject)", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse({}, 404));
    expect(await service().lookupAres(ICO)).toStrictEqual({ status: "not_found" });
  });

  it("fails soft to unavailable on an upstream 5xx", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse({}, 503));
    expect(await service().lookupAres(ICO)).toStrictEqual({ status: "unavailable" });
  });

  it("fails soft to unavailable on a network error / timeout", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("aborted"));
    expect(await service().lookupAres(ICO)).toStrictEqual({ status: "unavailable" });
  });

  it("rejects a malformed IČO with 400 BEFORE any upstream call", async () => {
    const fetchMock = vi.spyOn(global, "fetch");
    // "12345678" is the right shape but fails the mod-11 check digit.
    await expect(service().lookupAres("12345678")).rejects.toBeInstanceOf(BadRequestException);
    await expect(service().lookupAres("abc")).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never writes the IČO to a log line", async () => {
    const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse({}, 500));
    await service().lookupAres(ICO);
    expect(warn).toHaveBeenCalled();
    for (const call of warn.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(ICO);
    }
  });
});

describe("LookupsService.lookupVies", () => {
  it("maps a valid VAT number to valid + name/address and calls the right URL", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(
      jsonResponse({
        isValid: true,
        userError: "VALID",
        name: "ASD Software, s.r.o.",
        address: "Žerotínova 2981/55a, 787 01 Šumperk",
      }),
    );
    const result = await service().lookupVies(DIC);
    expect(fetchMock.mock.calls[0]![0]).toBe("https://vies.test/rest-api/ms/CZ/vat/26060469");
    expect(result).toStrictEqual({
      status: "valid",
      name: "ASD Software, s.r.o.",
      address: "Žerotínova 2981/55a, 787 01 Šumperk",
    });
  });

  it("reports a definite INVALID as invalid", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      jsonResponse({ isValid: false, userError: "INVALID" }),
    );
    expect(await service().lookupVies(DIC)).toStrictEqual({ status: "invalid" });
  });

  it("treats MS_UNAVAILABLE as unavailable, NOT invalid", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      jsonResponse({ isValid: false, userError: "MS_UNAVAILABLE" }),
    );
    expect(await service().lookupVies(DIC)).toStrictEqual({ status: "unavailable" });
  });

  it("fails soft to unavailable on a 5xx and on a network error", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse({}, 500));
    expect(await service().lookupVies(DIC)).toStrictEqual({ status: "unavailable" });
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("aborted"));
    expect(await service().lookupVies(DIC)).toStrictEqual({ status: "unavailable" });
  });

  it("rejects a malformed DIČ with 400 before any upstream call", async () => {
    const fetchMock = vi.spyOn(global, "fetch");
    await expect(service().lookupVies("CZ12")).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never writes the DIČ to a log line", async () => {
    const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    vi.spyOn(global, "fetch").mockResolvedValue(
      jsonResponse({ isValid: false, userError: "MS_UNAVAILABLE" }),
    );
    await service().lookupVies(DIC);
    for (const call of warn.mock.calls) {
      expect(JSON.stringify(call)).not.toContain("26060469");
    }
  });
});
