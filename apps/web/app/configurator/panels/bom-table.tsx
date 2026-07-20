"use client";

import * as React from "react";

import type { DerivationResult, Part } from "@repo/engine";
import { useLocale, useTranslations } from "@repo/i18n/web";
import { roundMoney, type BomCategory, type BomUnit, type RoundingPolicy } from "@repo/model";
import { cn, FadeScrollArea, Panel } from "@repo/ui";

import { formatMoney } from "../../../lib/format-money";

/**
 * The "Rozpad" view — the third tab of every canvas frame's view switch
 * (design/configurator/frames-v2.jsx:144), which the design export names but
 * never renders. Layout, grouping, columns and price visibility were undefined
 * there and are decided here.
 *
 * It renders the derivation's `parts` as a real, grouped table rather than the
 * flat three-column list `results-panel.tsx` shows beside the form: this view
 * owns the whole scene column, so it can afford the dimension and unit-price
 * columns that the sidebar cannot.
 *
 * ## Price visibility is STRUCTURAL, not conditional
 *
 * ADR 0056's workshop rule is absence, not masking — a price-blind sheet must
 * not carry an empty or dashed price cell, because a blank cell still tells the
 * reader "a number belongs here" and invites the question. That guarantee is
 * encoded in the COLUMN SET, not in per-cell `&&` guards: {@link BomTable}
 * builds its columns from `[...identityColumns, ...moneyColumns]` and
 * {@link BomTablePriceBlind} from `identityColumns` alone. There is no code path
 * in which a money `<th>` or `<td>` is emitted and then hidden, so the invariant
 * cannot be broken by editing a cell renderer — only by editing the column list.
 *
 * The same fact drives the totals: the subtotal and grand-total cells are
 * produced by a column's own {@link BomColumn.sum}, so a column set with no
 * summable column produces no `<tfoot>` at all. The server remains the price
 * authority; this is defence in depth.
 *
 * ## Why two components instead of a `priceBlind` boolean
 *
 * Per the repo's composition mandate, the variant is explicit at the call site:
 *
 * ```tsx
 * priceBlind
 *   ? <BomTable.PriceBlind result={result} rounding={pricing.rounding} />
 *   : <BomTable result={result} rounding={pricing.rounding} />
 * ```
 *
 * so reading the caller tells you which columns exist, and neither component
 * carries a conditional that a future edit could invert.
 */

/** Fixed render order — the same four buckets, in the same order, as the totals card. */
const CATEGORY_SECTIONS = [
  { category: "material", labelKey: "totalMaterial" },
  { category: "accessory", labelKey: "totalAccessory" },
  { category: "manufacturing", labelKey: "totalManufacturing" },
  { category: "installation", labelKey: "totalInstallation" },
] as const satisfies readonly { category: BomCategory; labelKey: string }[];

/** Absent value marker. Never used for a suppressed price — those cells do not exist. */
const ABSENT = "—";

/**
 * `BomUnit` → its catalog key. `satisfies Record<BomUnit, …>` makes the map
 * exhaustive, so a new unit in `@repo/model` fails the build here instead of
 * printing its English identifier into a Czech table.
 */
const UNIT_KEY = {
  meter: "unitMeter",
  piece: "unitPiece",
  set: "unitSet",
  hour: "unitHour",
} as const satisfies Record<BomUnit, string>;

/**
 * `result.money` is keyed by the four categories plus `total`, so one accessor
 * serves both the per-group subtotal and the grand total.
 */
type MoneyKey = BomCategory | "total";

/**
 * One column of the table. `sum` is what makes a column participate in the
 * subtotal and grand-total rows; a column without it renders an empty cell
 * there, and a column set without any `sum` suppresses the footer entirely.
 */
interface BomColumn {
  readonly id: string;
  readonly header: string;
  /** Right-aligns and applies `tabular-nums`, so digits line up down the column. */
  readonly numeric: boolean;
  readonly cell: (part: Part) => React.ReactNode;
  readonly sum?: (key: MoneyKey) => React.ReactNode;
}

interface BomSection {
  readonly category: BomCategory;
  readonly label: string;
  readonly parts: readonly Part[];
}

/**
 * Builds both column sets against the active locale and catalog. Money cells
 * take `Part.pricePerUnit` / `Part.totalPrice`, which are NUMBERS — the
 * decimal-string I10 boundary is `result.money`, and `String(n)` is the same
 * hand-off `results-panel.tsx` already makes.
 */
function useBomColumns(
  result: DerivationResult,
  rounding: RoundingPolicy,
): {
  readonly identity: readonly BomColumn[];
  readonly money: readonly BomColumn[];
} {
  const t = useTranslations("configurator");
  const locale = useLocale();

  return React.useMemo(() => {
    const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 });
    // Line money must be rounded to the ORG'S policy before display, exactly as
    // the engine rounds the totals underneath. `Part.totalPrice`/`pricePerUnit`
    // are raw derivation floats with no rounded mirror (unlike `result.money`,
    // and unlike `SiteBomLine.totalPriceMoney` on the site side), so rendering
    // them straight printed values like `1 023,744 Kč` — a sub-haléř amount that
    // is not payable in CZK — and left the displayed lines failing to add up to
    // the policy-rounded subtotal printed on the same row.
    const price = (value: number | undefined) =>
      value === undefined ? ABSENT : formatMoney(roundMoney(value, rounding), locale);

    return {
      identity: [
        {
          id: "item",
          header: t("bomItem"),
          numeric: false,
          cell: (part) => part.name,
        },
        {
          id: "quantity",
          header: t("bomQuantity"),
          numeric: true,
          // `unit` is a `BomUnit` enum, and printing it raw put an English
          // identifier into a Czech table ("12,5 meter"). The map is exhaustive
          // over the union, so adding a unit is a compile error here.
          cell: (part) => `${number.format(part.quantity)} ${t(UNIT_KEY[part.unit])}`,
        },
        {
          id: "dimension",
          header: t("bomDimension"),
          numeric: true,
          // Absent on BOM-only lines (labour, kits) — those have no run length.
          cell: (part) =>
            part.lengthMm === undefined ? ABSENT : `${number.format(part.lengthMm)} mm`,
        },
      ],
      money: [
        {
          id: "unitPrice",
          header: t("bomUnitPrice"),
          numeric: true,
          cell: (part) => price(part.pricePerUnit),
        },
        {
          id: "lineTotal",
          header: t("bomLineTotal"),
          numeric: true,
          cell: (part) => price(part.totalPrice),
          // Subtotals come off the engine's decimal strings, NOT from summing
          // the rendered line numbers — floats must never be re-added for display.
          sum: (key) => formatMoney(result.money[key], locale),
        },
      ],
    };
  }, [t, locale, result.money, rounding]);
}

function useBomSections(parts: readonly Part[], hasParts: boolean): readonly BomSection[] {
  const t = useTranslations("configurator");

  return React.useMemo(() => {
    if (!hasParts) return [];
    return CATEGORY_SECTIONS.map(({ category, labelKey }) => ({
      category,
      label: t(labelKey),
      parts: parts.filter((part) => part.category === category),
      // A bucket the release never emits is omitted outright rather than shown
      // as an empty heading.
    })).filter((section) => section.parts.length > 0);
  }, [parts, hasParts, t]);
}

function BomTableFrame({
  result,
  columns,
  className,
  ...props
}: React.ComponentProps<typeof Panel> & {
  result: DerivationResult;
  columns: readonly BomColumn[];
}) {
  const t = useTranslations("configurator");
  const titleId = React.useId();
  const sections = useBomSections(result.parts, result.parts.length > 0);
  const totalled = columns.some((column) => column.sum);

  return (
    <Panel className={cn("flex min-h-0 flex-col", className)} {...props}>
      <Panel.Header>
        <Panel.Title id={titleId}>{t("viewBom")}</Panel.Title>
      </Panel.Header>
      <Panel.Body className="min-h-0">
        {sections.length === 0 ? (
          <p className="text-muted-foreground text-ui-sm">{t("bomEmpty")}</p>
        ) : (
          // ONE scroll container for both axes: the viewport is `overflow-y-auto`,
          // and CSS forces the untouched axis from `visible` to `auto` whenever the
          // other is not visible — so the table scrolls sideways INSIDE the panel
          // and never widens the page body. `role`/`tabIndex` are passed rather
          // than left to the kit's default because that default keys off VERTICAL
          // overflow alone, and a wide-but-short table must still be keyboard
          // reachable (WCAG 2.1.1).
          <FadeScrollArea
            className="min-h-0 flex-1"
            role="region"
            tabIndex={0}
            aria-labelledby={titleId}
          >
            <FadeScrollArea.Fade position="both" />
            <table
              aria-labelledby={titleId}
              className="font-data text-ui-sm w-full border-collapse text-left"
            >
              <thead>
                <tr className="text-muted-foreground text-ui-xs">
                  {columns.map((column) => (
                    <th
                      key={column.id}
                      scope="col"
                      className={cn(
                        "bg-chrome sticky top-0 z-10 whitespace-nowrap py-2 pr-4 font-medium last:pr-0",
                        column.numeric && "text-right",
                      )}
                    >
                      {column.header}
                    </th>
                  ))}
                </tr>
              </thead>

              {sections.map((section) => (
                <tbody key={section.category}>
                  {/* `scope="rowgroup"` is what associates the heading with every
                      row of ITS tbody — the group header also carries the bucket
                      subtotal, so a group needs one row, not two, and no
                      "subtotal" label has to be invented. */}
                  <tr className="border-border border-t">
                    <th
                      scope="rowgroup"
                      className="text-muted-foreground text-ui-xs pb-1 pr-4 pt-4 font-semibold uppercase tracking-wide"
                    >
                      {section.label}
                    </th>
                    {columns.slice(1).map((column) => (
                      <td
                        key={column.id}
                        className={cn(
                          "whitespace-nowrap pb-1 pr-4 pt-4 last:pr-0",
                          column.numeric && "text-right tabular-nums",
                          column.sum && "text-foreground font-semibold",
                        )}
                      >
                        {column.sum?.(section.category)}
                      </td>
                    ))}
                  </tr>

                  {section.parts.map((part) => (
                    <tr key={part.path} className="border-border/60 border-t">
                      <th scope="row" className="py-1.5 pr-4 font-normal">
                        {part.name}
                      </th>
                      {columns.slice(1).map((column) => (
                        <td
                          key={column.id}
                          className={cn(
                            "whitespace-nowrap py-1.5 pr-4 last:pr-0",
                            column.numeric && "text-right tabular-nums",
                          )}
                        >
                          {column.cell(part)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              ))}

              {totalled && (
                <tfoot>
                  <tr className="border-border border-t-2">
                    <th scope="row" className="pr-4 pt-3 font-semibold">
                      {t("totalTotal")}
                    </th>
                    {columns.slice(1).map((column) => (
                      <td
                        key={column.id}
                        className={cn(
                          "whitespace-nowrap pr-4 pt-3 last:pr-0",
                          column.numeric && "text-right tabular-nums",
                          column.sum && "font-semibold",
                        )}
                      >
                        {column.sum?.("total")}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </FadeScrollArea>
        )}
      </Panel.Body>
    </Panel>
  );
}

/**
 * `elevation` is deliberately NOT forwardable: the sticky column-header row has
 * to paint an opaque background to cover the rows scrolling under it, and the
 * only surface it can name is the panel's default `bg-chrome`. Letting a caller
 * switch the panel to `flush` would leave the header a mismatched stripe.
 */
type BomTableProps = Omit<React.ComponentProps<typeof Panel>, "children" | "elevation"> & {
  result: DerivationResult;
  /** The org's commercial rounding policy (ADR 0081) — line money is rounded to
   *  it so the displayed lines add up to the policy-rounded subtotal beside them.
   *  Required on the price-blind variant too, so the two share one prop type and
   *  neither can drift into rendering unrounded money. */
  rounding: RoundingPolicy;
};

/** The priced rozpad: item, quantity, dimension, unit price, line total. */
function BomTablePriced({ result, rounding, ...props }: BomTableProps) {
  const { identity, money } = useBomColumns(result, rounding);
  const columns = React.useMemo(() => [...identity, ...money], [identity, money]);
  return <BomTableFrame result={result} columns={columns} {...props} />;
}

/**
 * The workshop rozpad (ADR 0056): item, quantity, dimension. Both money columns
 * and the grand-total row are ABSENT — no header, no cell, nothing to unmask.
 */
function BomTablePriceBlind({ result, rounding, ...props }: BomTableProps) {
  const { identity } = useBomColumns(result, rounding);
  return <BomTableFrame result={result} columns={identity} {...props} />;
}

const BomTable = Object.assign(BomTablePriced, {
  PriceBlind: BomTablePriceBlind,
});

export { BomTable };
