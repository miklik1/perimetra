"use client";

import Link from "next/link";

import { useTranslations } from "@repo/i18n/web";
import { Button, DisplayLabel, Panel } from "@repo/ui";
import { type QuoteProduction } from "@repo/validators";

import { PrintSheetStyle } from "../../../../../lib/print/print-sheet-style";
import { QuoteStatusBadge } from "../../../quote-status";
import { CutListPanel } from "../cut-list-panel";
import { TechnicalDrawingSvg } from "../technical-drawing-svg";

/**
 * The workshop TRAVELER document (ADR 0108) — the printable, price-blind sheet a
 * fabricator builds from. Lays out the ROLE-INDEPENDENT `QuoteProduction`
 * (never a money/cost/margin field, by construction of the schema) per instance:
 * identity header, the derived 2D technical drawing (elevation + sections,
 * ADR 0102), spec rows and dimension rows — then the site-level grouped BOM and
 * the shared cut list. Browser print() to PDF (ADR 0087, the nabídka precedent):
 * an inline @page/@media-print <style> (CSP-allowed; @page cannot be a utility),
 * a `.no-print` toolbar, and break-inside guards so the long tables split
 * cleanly across A4 pages. Reuses `CutListPanel` and the sibling
 * `TechnicalDrawingSvg` — no forked layout.
 */

/** Group the site-level BOM by category, first-seen order preserved. Production
 *  carries only quantities/units (no price exists) — a group is a heading + rows. */
function groupByCategory(bom: QuoteProduction["bom"]): [string, QuoteProduction["bom"]][] {
  const groups = new Map<string, QuoteProduction["bom"]>();
  for (const line of bom) {
    const existing = groups.get(line.category);
    if (existing) existing.push(line);
    else groups.set(line.category, [line]);
  }
  return [...groups];
}

export function TravelerDocument({
  production,
  backHref,
}: {
  production: QuoteProduction;
  backHref: string;
}) {
  const t = useTranslations("quotes");
  // Literal keys (next-intl's typed `t` rejects dynamic template-literal keys);
  // an unknown catalog category falls back to its raw code.
  const categoryLabel: Record<string, string> = {
    material: t("production.categories.material"),
    accessory: t("production.categories.accessory"),
    manufacturing: t("production.categories.manufacturing"),
    installation: t("production.categories.installation"),
  };
  const bomGroups = groupByCategory(production.bom);

  return (
    <main className="bg-field min-h-screen">
      {/* The reused CutListPanel rows can't carry a break utility, so they are
          kept whole here by descendant selector. */}
      <PrintSheetStyle
        margin="16mm 14mm"
        extra="  .traveler-sheet tr, .traveler-sheet li { break-inside: avoid; }"
      />

      {/* Toolbar — screen only */}
      <div className="no-print mx-auto flex w-full max-w-[210mm] items-center justify-between gap-4 px-6 pt-6">
        <Link href={backHref} className="text-muted-foreground text-sm hover:underline">
          ← {t("production.title")}
        </Link>
        <Button type="button" variant="copper-outline" onClick={() => window.print()}>
          {t("production.print")}
        </Button>
      </div>

      {/* The document sheet */}
      <article className="traveler-sheet bg-background text-foreground mx-auto my-6 flex w-full max-w-[210mm] flex-col gap-6 p-8 shadow-sm print:my-0 print:p-0 print:shadow-none">
        <header className="border-border flex items-start justify-between border-b pb-4">
          <div className="flex flex-col gap-1">
            <DisplayLabel as="h1" className="text-3xl">
              {t("production.traveler")}
            </DisplayLabel>
            <p className="font-data text-muted-foreground text-sm">{production.documentNumber}</p>
          </div>
          <QuoteStatusBadge status={production.status} />
        </header>

        {/* Per instance: identity + drawing + spec + dimensions. */}
        {production.instances.map(({ instanceId, releaseId }) => {
          const drawing = production.technicalDrawings?.[instanceId];
          const specs = production.specRows?.[instanceId] ?? [];
          const dims = production.dimensionRows?.[instanceId] ?? [];
          return (
            <Panel key={instanceId} className="flex break-inside-avoid flex-col gap-4">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-base font-semibold">
                  {t("production.instance")}: {instanceId}
                  <span className="text-muted-foreground font-data ml-2 text-xs">{releaseId}</span>
                </h2>
                {/* The document number rides every instance block — a printed
                    sheet may be torn off and handled on its own. */}
                <span className="text-muted-foreground font-data text-xs">
                  {production.documentNumber}
                </span>
              </div>

              {drawing && (
                <div>
                  <h3 className="text-muted-foreground mb-1 text-xs uppercase">
                    {t("production.elevation")}
                  </h3>
                  <TechnicalDrawingSvg drawing={drawing} className="h-72 w-full" />
                </div>
              )}

              {specs.length > 0 && (
                <div>
                  <h3 className="text-muted-foreground mb-1 text-xs uppercase">
                    {t("production.spec")}
                  </h3>
                  <table className="font-data w-full text-left text-sm">
                    <tbody>
                      {specs.map((row) => (
                        <tr key={row.key} className="border-border border-t">
                          <td className="text-muted-foreground py-1 pr-4">{row.label}</td>
                          <td className="py-1">{row.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {dims.length > 0 && (
                <div>
                  <h3 className="text-muted-foreground mb-1 text-xs uppercase">
                    {t("production.dimensions")}
                  </h3>
                  <table className="font-data w-full text-left text-sm">
                    <tbody>
                      {dims.map((row) => (
                        <tr key={row.id} className="border-border border-t">
                          <td className="text-muted-foreground py-1 pr-4">{row.label}</td>
                          <td className="py-1 text-right tabular-nums">
                            {Math.round(row.valueMm)} mm
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          );
        })}

        {/* Site-level grouped BOM — quantities + units only (no price exists). */}
        <Panel className="flex flex-col gap-4">
          <h2 className="text-base font-semibold">{t("production.bom")}</h2>
          {bomGroups.map(([category, lines]) => (
            <div key={category} className="flex flex-col gap-1">
              <h3 className="text-muted-foreground text-xs uppercase">
                {categoryLabel[category] ?? category}
              </h3>
              <table className="font-data w-full text-left text-sm">
                <thead>
                  <tr className="text-muted-foreground text-xs uppercase">
                    <th className="py-1 font-medium">{t("production.bomItem")}</th>
                    <th className="py-1 text-right font-medium">{t("production.bomQuantity")}</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.componentCode} className="border-border border-t">
                      <td className="py-1">
                        {line.name}
                        <span className="text-muted-foreground ml-2 text-xs">
                          {line.componentCode}
                        </span>
                      </td>
                      <td className="py-1 text-right tabular-nums">
                        {line.quantity} {line.unit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </Panel>

        {/* The cut list — reused as-is (ADR 0101); its rows are kept whole by the
            print <style> above so the long list splits cleanly across A4 pages. */}
        <CutListPanel cutList={production.cutList} kerfMm={production.cutOptions.kerfMm} />
      </article>
    </main>
  );
}
