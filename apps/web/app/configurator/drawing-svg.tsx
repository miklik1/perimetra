import type { SitePlan, WorkshopDrawing } from "@repo/renderers";

/**
 * SVG presentation of the pure 2D drawings `@repo/renderers` emits (ADR 0077,
 * technique 10 — the hybrid-coverage half). `drawing2d.ts` does all the geometry
 * (I4); these components only draw it. Used for the Lokalita/Půdorys plan, the
 * Summary side-elevation, and the WebGL-unavailable fallback — zero GPU, so they
 * also render where R3F can't.
 *
 * Drawings are in mm with Y up; SVG is Y down, so every point maps y → (maxY−y)
 * and strokes use `vector-effect="non-scaling-stroke"` to stay crisp at any
 * viewBox scale. Deviated pieces (CORE_SPEC §6) draw in the brand deviation amber
 * — the 2D mirror of the 3D markers.
 */
const DEVIATION = "#f59e0b";
const INK = "#3a4046";
const FILL = "#c9ced2";

interface Box {
  min: { x: number; y: number };
  max: { x: number; y: number };
}

function viewFrame(bbox: Box): { viewBox: string; sy: (y: number) => number; unit: number } {
  const spanX = bbox.max.x - bbox.min.x;
  const spanY = bbox.max.y - bbox.min.y;
  const pad = Math.max(spanX, spanY) * 0.08 + 50;
  const minX = bbox.min.x - pad;
  const maxY = bbox.max.y + pad;
  const vbW = spanX + pad * 2;
  const vbH = spanY + pad * 2;
  return {
    viewBox: `${minX} 0 ${vbW} ${vbH}`,
    sy: (y: number) => maxY - y,
    unit: Math.max(vbW, vbH),
  };
}

/** Front elevation (workshop view) — the Summary spec drawing + the WebGL-down
 *  fallback. Renders every piece face; deviated faces + a flag legend in amber. */
export function WorkshopDrawingSvg({
  drawing,
  className,
}: {
  drawing: WorkshopDrawing;
  className?: string;
}) {
  const { quads, dims, flags, bbox } = drawing;
  if (quads.length === 0) return null;
  const { viewBox, sy, unit } = viewFrame(bbox);
  const stroke = 1.4;
  const fontSize = unit / 26;

  return (
    <div className={className}>
      <svg viewBox={viewBox} className="h-full w-full" role="img">
        {quads.map((q) => (
          <polygon
            key={q.id}
            points={q.points.map((p) => `${p.x},${sy(p.y)}`).join(" ")}
            fill={q.deviated === true ? DEVIATION : FILL}
            stroke={q.deviated === true ? DEVIATION : INK}
            strokeWidth={stroke}
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
          />
        ))}
        {dims.map((d) => (
          <g key={d.id} fill={INK} stroke="none">
            <text
              x={(d.from.x + d.to.x) / 2}
              y={sy((d.from.y + d.to.y) / 2) - fontSize * 0.4}
              fontSize={fontSize}
              textAnchor="middle"
              className="tabular-nums"
            >
              {Math.round(d.valueMm)} mm
            </text>
          </g>
        ))}
      </svg>
      {flags.length > 0 && (
        <ul className="mt-2 flex flex-col gap-0.5 text-xs">
          {flags.map((f) => (
            <li key={f.overrideId} style={{ color: DEVIATION }} className="font-medium">
              {f.partPath} · {f.field}: {f.original !== undefined ? `${f.original} → ` : ""}
              {f.value}
              {f.reason !== undefined && (
                <span className="text-muted-foreground"> · {f.reason}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Top-down site plan (Půdorys) — instance footprints + connections. For a single
 *  gate it shows the panel + slide envelope; deviation lives on the elevation. */
export function SitePlanSvg({ plan, className }: { plan: SitePlan; className?: string }) {
  const pts = plan.instances.flatMap((i) => i.outline);
  if (pts.length === 0) return null;
  const bbox: Box = {
    min: { x: Math.min(...pts.map((p) => p.x)), y: Math.min(...pts.map((p) => p.y)) },
    max: { x: Math.max(...pts.map((p) => p.x)), y: Math.max(...pts.map((p) => p.y)) },
  };
  const { viewBox, sy } = viewFrame(bbox);

  return (
    <div className={className}>
      <svg viewBox={viewBox} className="h-full w-full" role="img">
        {plan.connections.map((c) => (
          <line
            key={c.connection}
            x1={c.from.x}
            y1={sy(c.from.y)}
            x2={c.to.x}
            y2={sy(c.to.y)}
            stroke={INK}
            strokeWidth={1.2}
            strokeDasharray="6 4"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {plan.instances.map((inst) => (
          <polygon
            key={inst.instanceId}
            points={inst.outline.map((p) => `${p.x},${sy(p.y)}`).join(" ")}
            fill={FILL}
            stroke={INK}
            strokeWidth={1.4}
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
          />
        ))}
      </svg>
    </div>
  );
}
