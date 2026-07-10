"use client";

import { useId } from "react";

import type { TechnicalDrawing } from "@repo/renderers";

import { dimensionText, technicalDrawingFrame } from "./technical-drawing-frame";

/**
 * SVG presentation of the derived `TechnicalDrawing` (ADR 0102) — the edges,
 * feature-bound dimensions/chains/labels and hatched cross-sections the emitter
 * produced as pure data (I4). Sibling of `configurator/drawing-svg.tsx` but for
 * the NEW technical drawing, not the flat-quad `WorkshopDrawing`.
 *
 * Everything is ink-only on white (no color-only encoding): roles read by dash
 * pattern + weight, sections by hatch vs a dashed nominal-depth outline. Strokes
 * use `vector-effect="non-scaling-stroke"` so hairlines survive print scaling on
 * an A4 sheet. Framing (viewBox / Y-flip / section layout) is the pure
 * `technical-drawing-frame` module.
 */
const INK = "#111827";

function edgeDash(role: string): string | undefined {
  if (role === "hidden") return "6 4";
  if (role === "center") return "9 3 3 3";
  return undefined;
}

export function TechnicalDrawingSvg({
  drawing,
  className,
}: {
  drawing: TechnicalDrawing;
  className?: string;
}) {
  const rawId = useId();
  const hatchId = `hatch-${rawId.replace(/:/g, "")}`;
  const { viewBox, sy, unit, sections } = technicalDrawingFrame(drawing);

  const dimFont = unit / 55;
  const labelFont = unit / 34;
  const sectionFont = unit / 48;
  const tick = unit / 180;
  const hatch = unit / 140;

  return (
    <div className={className}>
      <svg viewBox={viewBox} className="h-full w-full" role="img" aria-label="Technický výkres">
        <defs>
          <pattern
            id={hatchId}
            patternUnits="userSpaceOnUse"
            width={hatch}
            height={hatch}
            patternTransform="rotate(45)"
          >
            <line x1={0} y1={0} x2={0} y2={hatch} stroke={INK} strokeWidth={unit / 1400} />
          </pattern>
        </defs>

        {/* Projected elevation edges. */}
        {drawing.edges.map((e) => (
          <line
            key={e.id}
            x1={e.from.x}
            y1={sy(e.from.y)}
            x2={e.to.x}
            y2={sy(e.to.y)}
            stroke={INK}
            strokeWidth={e.role === "center" ? 0.7 : 1.6}
            strokeDasharray={edgeDash(e.role)}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {/* Dimensions / chains / labels. */}
        {drawing.annotations.map((a) => {
          if (a.kind === "label") {
            return (
              <g key={a.id}>
                <circle
                  cx={a.textAt.x}
                  cy={sy(a.textAt.y)}
                  r={labelFont * 0.85}
                  fill="#fff"
                  stroke={INK}
                  strokeWidth={1.2}
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  x={a.textAt.x}
                  y={sy(a.textAt.y)}
                  fontSize={labelFont}
                  fill={INK}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontWeight={600}
                >
                  {a.text}
                </text>
              </g>
            );
          }

          const vertical =
            Math.abs(a.line.to.y - a.line.from.y) > Math.abs(a.line.to.x - a.line.from.x);
          return (
            <g key={a.id} stroke={INK}>
              {a.witness.map((w, i) => (
                <line
                  key={`${a.id}-w${i}`}
                  x1={w.from.x}
                  y1={sy(w.from.y)}
                  x2={w.to.x}
                  y2={sy(w.to.y)}
                  strokeWidth={0.8}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              <line
                x1={a.line.from.x}
                y1={sy(a.line.from.y)}
                x2={a.line.to.x}
                y2={sy(a.line.to.y)}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              {/* 45° end slashes (architectural dimension terminators). */}
              {[a.line.from, a.line.to].map((p, i) => (
                <line
                  key={`${a.id}-e${i}`}
                  x1={p.x - tick}
                  y1={sy(p.y - tick)}
                  x2={p.x + tick}
                  y2={sy(p.y + tick)}
                  strokeWidth={1.2}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {/* Chain ticks — one mark per repeated piece, perpendicular to the line. */}
              {a.ticks?.map((t, i) =>
                vertical ? (
                  <line
                    key={`${a.id}-c${i}`}
                    x1={t.x - tick}
                    y1={sy(t.y)}
                    x2={t.x + tick}
                    y2={sy(t.y)}
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                ) : (
                  <line
                    key={`${a.id}-c${i}`}
                    x1={t.x}
                    y1={sy(t.y - tick)}
                    x2={t.x}
                    y2={sy(t.y + tick)}
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                ),
              )}
              {/* Vertical dims read bottom-to-top alongside the line (drafting
                  convention) so lane-stacked texts don't collide horizontally. */}
              <text
                x={a.textAt.x}
                y={sy(a.textAt.y)}
                fontSize={dimFont}
                fill={INK}
                stroke="none"
                textAnchor="middle"
                dominantBaseline="central"
                transform={vertical ? `rotate(-90 ${a.textAt.x} ${sy(a.textAt.y)})` : undefined}
                className="tabular-nums"
              >
                {dimensionText(a)}
              </text>
            </g>
          );
        })}

        {/* Hatched cross-sections beside the elevation. A nominal-depth cut (no
            catalog depth) draws as a dashed, un-hatched outline so it never reads
            as a measured profile (I5). */}
        {sections.map((ps) => (
          <g key={ps.section.sectionId}>
            {ps.section.cuts.map((cut) => (
              <polygon
                key={cut.sourceId}
                points={cut.outline.map((p) => `${p.x + ps.dx},${sy(p.y + ps.dy)}`).join(" ")}
                fill={cut.nominalDepth ? "none" : `url(#${hatchId})`}
                stroke={INK}
                strokeWidth={1.3}
                strokeDasharray={cut.nominalDepth ? "5 4" : undefined}
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
              />
            ))}
            <text
              x={ps.labelAt.x}
              y={sy(ps.labelAt.y) - sectionFont}
              fontSize={sectionFont}
              fill={INK}
              textAnchor="middle"
              fontWeight={600}
            >
              {ps.section.sectionId}
            </text>
            {ps.section.dataFillNeeded && (
              <text
                x={ps.labelAt.x}
                y={sy(ps.bbox.min.y) + sectionFont * 1.4}
                fontSize={sectionFont * 0.72}
                fill={INK}
                textAnchor="middle"
              >
                orientační hloubka
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}
