/**
 * CZ-tax golden corpus (ADR 0080) — canonical, hand-verified tax documents off
 * the re-baselined net goldens (ADR 0081). The harness (`../tax.test.ts`)
 * derives the REAL site/gate net total from the engine and feeds it through the
 * pure `deriveTaxBreakdown`, proving the structured tax layer reproduces these
 * byte-identically (the I3 freeze re-derives the same).
 *
 * Cases (the order's required coverage):
 *   1. standard 21 % — site net 134 723.5 → VAT 28 291.94 → gross 163 015.44
 *   2. §92e reverse charge — site net 134 723.5, NO VAT line, gross == net, legend
 *   3. mixed rate — 21 % + 12 % bases, per-rate VAT, descending order
 *   4. rounding edges — VAT amounts that need haléř rounding (half-up)
 *
 * The VAT/§92e CONSTANTS are PROVISIONAL (accountant-gated, ADR 0080); the
 * STRUCTURE is the golden.
 */
import {
  DEFAULT_ROUNDING_POLICY,
  REVERSE_CHARGE_92E_LEGEND_CS,
  type RateBase,
  type TaxBreakdown,
} from "@repo/model";

/** The standard CZ VAT rate the corpus prices at (PROVISIONAL). */
const STANDARD_VAT_PCT = "21";

/** The re-baselined site net total (golden/site.ts, ADR 0081) — the base every
 *  single-rate tax case uses; the harness re-derives it from the engine. */
export const SITE_NET = "134723.5";

export const taxGolden = {
  /** 1. Standard 21 % on the whole site net. */
  standard: {
    base: [{ ratePct: STANDARD_VAT_PCT, netBase: SITE_NET }] as RateBase[],
    expected: {
      mode: "standard_vat",
      currency: "CZK",
      rounding: DEFAULT_ROUNDING_POLICY,
      lines: [{ ratePct: "21", netBase: "134723.5", vatAmount: "28291.94", gross: "163015.44" }],
      netTotal: "134723.5",
      vatTotal: "28291.94",
      grossTotal: "163015.44",
    } satisfies TaxBreakdown,
  },

  /** 2. §92e reverse charge — a NO-VAT-line document carrying the legend. */
  reverseCharge: {
    base: [{ ratePct: STANDARD_VAT_PCT, netBase: SITE_NET }] as RateBase[],
    expected: {
      mode: "reverse_charge_92e",
      legend: REVERSE_CHARGE_92E_LEGEND_CS,
      currency: "CZK",
      rounding: DEFAULT_ROUNDING_POLICY,
      lines: [{ ratePct: "21", netBase: "134723.5", vatAmount: "0", gross: "134723.5" }],
      netTotal: "134723.5",
      vatTotal: "0",
      grossTotal: "134723.5",
    } satisfies TaxBreakdown,
  },

  /** 3. Mixed rate — 100 000 @ 21 % + 10 000 @ 12 %, lines sorted descending. */
  mixed: {
    base: [
      { ratePct: "12", netBase: "10000" },
      { ratePct: "21", netBase: "100000" },
    ] as RateBase[],
    expected: {
      mode: "standard_vat",
      currency: "CZK",
      rounding: DEFAULT_ROUNDING_POLICY,
      lines: [
        { ratePct: "21", netBase: "100000", vatAmount: "21000", gross: "121000" },
        { ratePct: "12", netBase: "10000", vatAmount: "1200", gross: "11200" },
      ],
      netTotal: "110000",
      vatTotal: "22200",
      grossTotal: "132200",
    } satisfies TaxBreakdown,
  },

  /** 4. Rounding edges — bases whose 21 % VAT needs haléř rounding (half-up):
   *     100.10 × 21 % = 21.021 → 21.02 ; 1234.55 × 21 % = 259.2555 → 259.26. */
  roundingEdges: {
    base: [{ ratePct: "21", netBase: "1334.65" }] as RateBase[],
    expected: {
      mode: "standard_vat",
      currency: "CZK",
      rounding: DEFAULT_ROUNDING_POLICY,
      // 1334.65 × 21 % = 280.2765 → 280.28 (half-up on the 3rd decimal 6).
      lines: [{ ratePct: "21", netBase: "1334.65", vatAmount: "280.28", gross: "1614.93" }],
      netTotal: "1334.65",
      vatTotal: "280.28",
      grossTotal: "1614.93",
    } satisfies TaxBreakdown,
  },
} as const;
