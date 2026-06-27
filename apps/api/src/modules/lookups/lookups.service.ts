/**
 * Registry-lookup service (ADR 0090) — proxies the public CZ ARES register
 * (IČO → name/address/DIČ) and the EU VIES service (DIČ → VAT-payer validity).
 *
 * Discipline:
 *  - FAIL SOFT. An upstream outage/timeout/parse-failure returns `unavailable`
 *    (ARES) or `unavailable` (VIES) — NEVER an exception. The lookup is a typing
 *    convenience; it must never block manual customer entry (acceptance, ADR 0090).
 *  - A malformed key is a CLIENT error (400 `invalid_ico`/`invalid_dic`), checked
 *    BEFORE any outbound call so a bad request can't spend upstream quota.
 *  - NO PII in logs. The IČO/DIČ being looked up is never written to a log line
 *    (a sole-trader IČO is quasi-personal, and the customer columns are `pii()`).
 *  - No persistence, no Redis, no jobs — a synchronous request-path fetch with a
 *    bounded `AbortSignal.timeout`, mirroring `RealtimeService`'s fail-soft shape.
 */
import { BadRequestException, Inject, Injectable, Logger } from "@nestjs/common";

import {
  lookupDicSchema,
  lookupIcoSchema,
  type AresLookup,
  type ViesLookup,
} from "@repo/validators/lookups";

import { ENV, type Env } from "../../common/config/env.js";

/** Bounded request-path timeouts — ARES is a single register; VIES proxies to
 *  national systems and is slower, so it gets a longer (still bounded) budget. */
const ARES_TIMEOUT_MS = 3_000;
const VIES_TIMEOUT_MS = 5_000;

/** Loosely-typed slice of the ARES `ekonomicke-subjekty/{ico}` payload — a third
 *  party's shape, read defensively (never `.parse()`d against our own schema). */
interface AresRaw {
  obchodniJmeno?: string;
  dic?: string;
  datumZaniku?: string | null;
  sidlo?: {
    nazevUlice?: string;
    cisloDomovni?: number | string;
    cisloOrientacni?: number | string;
    cisloOrientacniPismeno?: string;
    nazevObce?: string;
    nazevCastiObce?: string;
    psc?: number | string;
    textovaAdresa?: string;
  };
}

/** Loosely-typed slice of the VIES REST `rest-api/ms/{cc}/vat/{n}` payload. */
interface ViesRaw {
  isValid?: boolean;
  userError?: string;
  name?: string;
  address?: string;
}

@Injectable()
export class LookupsService {
  private readonly logger = new Logger(LookupsService.name);

  constructor(@Inject(ENV) private readonly env: Env) {}

  /** IČO → ARES subject. Fails soft to `unavailable`; `not_found` on a 404. */
  async lookupAres(ico: string): Promise<AresLookup> {
    if (!lookupIcoSchema.safeParse(ico).success) {
      throw new BadRequestException({ message: "Invalid IČO", code: "invalid_ico" });
    }
    try {
      const response = await fetch(`${this.env.ARES_BASE_URL}/ekonomicke-subjekty/${ico}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(ARES_TIMEOUT_MS),
      });
      // ARES 404s an unknown IČO — a definite "no such subject", not an outage.
      if (response.status === 404) return { status: "not_found" };
      if (!response.ok) {
        this.logger.warn(`ARES lookup failed: HTTP ${response.status}`);
        return { status: "unavailable" };
      }
      return mapAres(ico, (await response.json()) as AresRaw);
    } catch (error) {
      this.logger.warn(
        `ARES unreachable: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { status: "unavailable" };
    }
  }

  /** DIČ → VIES validity. `unavailable` (NOT `invalid`) on outage/timeout. */
  async lookupVies(dic: string): Promise<ViesLookup> {
    if (!lookupDicSchema.safeParse(dic).success) {
      throw new BadRequestException({ message: "Invalid DIČ", code: "invalid_dic" });
    }
    // DIČ = country prefix (CZ) + the bare number; VIES wants them separated and
    // the number WITHOUT the prefix.
    const countryCode = dic.slice(0, 2);
    const vatNumber = dic.slice(2);
    try {
      const response = await fetch(
        `${this.env.VIES_BASE_URL}/rest-api/ms/${countryCode}/vat/${vatNumber}`,
        { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(VIES_TIMEOUT_MS) },
      );
      if (!response.ok) {
        this.logger.warn(`VIES lookup failed: HTTP ${response.status}`);
        return { status: "unavailable" };
      }
      const raw = (await response.json()) as ViesRaw;
      if (raw.isValid === true) {
        return {
          status: "valid",
          name: raw.name?.trim() || null,
          address: raw.address?.trim() || null,
        };
      }
      // Only a definite INVALID is reported as invalid; MS_UNAVAILABLE / any
      // other error code reads as inconclusive (never a false "bad number").
      if (raw.userError === "INVALID") return { status: "invalid" };
      this.logger.warn(`VIES inconclusive: ${raw.userError ?? "unknown"}`);
      return { status: "unavailable" };
    } catch (error) {
      this.logger.warn(
        `VIES unreachable: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { status: "unavailable" };
    }
  }
}

/** Map an ARES subject payload onto our discriminated `found` result. The street
 *  sub-fields are absent for small municipalities, so `line` falls back through
 *  street → city-part → textová adresa. `country` is `CZ` (the Czech register). */
function mapAres(ico: string, raw: AresRaw): AresLookup {
  const seat = raw.sidlo ?? {};
  const houseNumber = [seat.cisloDomovni, seat.cisloOrientacni]
    .filter((part) => part != null && `${part}`.length > 0)
    .join("/");
  const line =
    (seat.nazevUlice ? `${seat.nazevUlice}${houseNumber ? ` ${houseNumber}` : ""}` : null) ??
    seat.nazevCastiObce ??
    seat.textovaAdresa ??
    null;
  return {
    status: "found",
    ico,
    name: raw.obchodniJmeno ?? "",
    dic: raw.dic ?? null,
    address: {
      line: line ?? null,
      city: seat.nazevObce ?? null,
      postalCode: seat.psc != null ? `${seat.psc}` : null,
      country: "CZ",
    },
    dissolved: raw.datumZaniku != null,
  };
}
