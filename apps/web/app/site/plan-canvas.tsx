"use client";

import { useRef, type PointerEvent as ReactPointerEvent } from "react";

import { useTranslations } from "@repo/i18n/web";
import { cn } from "@repo/ui";

import { portsCompatible, type InstanceUi, type PlanConnection } from "./derive";

/**
 * The site plan editor (CORE_SPEC §8, step 6 slice 2): a top-down SVG view of
 * the placed instances where the user selects, drags (pose origin), and
 * connects ports. Geometry is never recomputed here — outlines come from the
 * renderer's `SitePlan` and port handles from engine-derived anchors (I4); this
 * component only positions, hit-tests, and emits intent. Pointer math goes
 * through the SVG CTM so it survives any zoom/letterbox; when the CTM is
 * unavailable (jsdom), drag simply no-ops and selection/connect still work.
 */
const GRID_MM = 50;
const PAD_FRACTION = 0.12;
const MIN_SPAN_MM = 2000;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  span: number;
}

export interface PlanCanvasProps {
  instances: InstanceUi[];
  connections: PlanConnection[];
  selectedId?: string;
  connectFrom?: { instanceId: string; portId: string };
  onSelect: (id?: string) => void;
  onMove: (instanceId: string, origin: { x: number; y: number }) => void;
  onPortClick: (instanceId: string, portId: string) => void;
  onRemoveConnection: (index: number) => void;
}

function planBounds(instances: InstanceUi[], connections: PlanConnection[]): Box {
  const xs: number[] = [];
  const ys: number[] = [];
  const push = (p: { x: number; y: number }) => {
    xs.push(p.x);
    ys.push(p.y);
  };
  for (const instance of instances) {
    instance.footprint?.outline.forEach(push);
    for (const port of instance.ports) if (port.at) push(port.at);
    push({ x: instance.placement.pose.origin_mm.x, y: instance.placement.pose.origin_mm.y });
  }
  for (const c of connections) {
    push(c.from);
    push(c.to);
  }
  if (xs.length === 0)
    return {
      x: -MIN_SPAN_MM / 2,
      y: -MIN_SPAN_MM / 2,
      w: MIN_SPAN_MM,
      h: MIN_SPAN_MM,
      span: MIN_SPAN_MM,
    };

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const w = Math.max(maxX - minX, MIN_SPAN_MM);
  const h = Math.max(maxY - minY, MIN_SPAN_MM);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const padX = w * PAD_FRACTION;
  const padY = h * PAD_FRACTION;
  return {
    x: cx - w / 2 - padX,
    y: cy - h / 2 - padY,
    w: w + 2 * padX,
    h: h + 2 * padY,
    span: Math.max(w, h),
  };
}

/** Pointer → plan-mm coordinates via the SVG screen CTM. Returns undefined when
 *  the CTM/SVGPoint API is unavailable (jsdom) so callers can no-op. */
function toPlan(svg: SVGSVGElement, e: ReactPointerEvent): { x: number; y: number } | undefined {
  const ctm = svg.getScreenCTM?.();
  if (ctm == null || typeof svg.createSVGPoint !== "function") return undefined;
  const point = svg.createSVGPoint();
  point.x = e.clientX;
  point.y = e.clientY;
  const local = point.matrixTransform(ctm.inverse());
  return { x: local.x, y: local.y };
}

const pointsAttr = (pts: { x: number; y: number }[]) => pts.map((p) => `${p.x},${p.y}`).join(" ");

export function PlanCanvas({
  instances,
  connections,
  selectedId,
  connectFrom,
  onSelect,
  onMove,
  onPortClick,
  onRemoveConnection,
}: PlanCanvasProps) {
  const t = useTranslations("site");
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{
    instanceId: string;
    startPointer: { x: number; y: number };
    startOrigin: { x: number; y: number };
  } | null>(null);

  const box = planBounds(instances, connections);
  const handleR = box.span / 70;
  const fontSize = box.span / 42;
  const stroke = box.span / 280;

  const source = connectFrom
    ? instances
        .find((i) => i.instanceId === connectFrom.instanceId)
        ?.ports.find((p) => p.portId === connectFrom.portId)
    : undefined;

  const beginDrag = (e: ReactPointerEvent, instance: InstanceUi) => {
    onSelect(instance.instanceId);
    const svg = svgRef.current;
    if (svg == null) return;
    const start = toPlan(svg, e);
    if (start === undefined) return;
    drag.current = {
      instanceId: instance.instanceId,
      startPointer: start,
      startOrigin: { ...instance.placement.pose.origin_mm },
    };
    svg.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const session = drag.current;
    const svg = svgRef.current;
    if (session == null || svg == null) return;
    const at = toPlan(svg, e);
    if (at === undefined) return;
    const snap = (v: number) => Math.round(v / GRID_MM) * GRID_MM;
    onMove(session.instanceId, {
      x: snap(session.startOrigin.x + (at.x - session.startPointer.x)),
      y: snap(session.startOrigin.y + (at.y - session.startPointer.y)),
    });
  };

  const endDrag = (e: ReactPointerEvent) => {
    if (drag.current == null) return;
    svgRef.current?.releasePointerCapture?.(e.pointerId);
    drag.current = null;
  };

  return (
    <div className="border-border bg-background relative aspect-[4/3] w-full overflow-hidden rounded-md border">
      <svg
        ref={svgRef}
        role="img"
        aria-label={t("planLabel")}
        viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
        className="h-full w-full touch-none"
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {/* Background — catches clicks on empty plot to deselect / cancel connect. */}
        <rect
          x={box.x}
          y={box.y}
          width={box.w}
          height={box.h}
          className="fill-background"
          onPointerDown={() => onSelect(undefined)}
        />

        {connections.map((c) => {
          const mid = { x: (c.from.x + c.to.x) / 2, y: (c.from.y + c.to.y) / 2 };
          return (
            <g key={c.index}>
              <line
                x1={c.from.x}
                y1={c.from.y}
                x2={c.to.x}
                y2={c.to.y}
                vectorEffect="non-scaling-stroke"
                strokeWidth={c.valid ? 2 : 2.5}
                strokeDasharray={c.valid ? undefined : "6 4"}
                className={c.valid ? "stroke-primary" : "stroke-destructive"}
              />
              {c.shared && (
                <circle
                  cx={mid.x}
                  cy={mid.y}
                  r={handleR * 0.5}
                  className="fill-primary"
                  aria-label={t("sharedElement")}
                />
              )}
              <g
                className="cursor-pointer"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onRemoveConnection(c.index);
                }}
                aria-label={t("removeConnection")}
                role="button"
              >
                <circle
                  cx={mid.x}
                  cy={mid.y + handleR * 1.6}
                  r={handleR * 0.7}
                  className="fill-muted stroke-border"
                  strokeWidth={stroke}
                />
                <text
                  x={mid.x}
                  y={mid.y + handleR * 1.6}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={fontSize * 0.9}
                  className="fill-muted-foreground pointer-events-none select-none"
                >
                  ×
                </text>
              </g>
            </g>
          );
        })}

        {instances.map((instance) => {
          const selected = instance.instanceId === selectedId;
          const label = `${instance.product.release.modelId} · ${instance.instanceId}`;
          return (
            <g key={instance.instanceId}>
              {instance.footprint ? (
                <polygon
                  points={pointsAttr(instance.footprint.outline)}
                  vectorEffect="non-scaling-stroke"
                  strokeWidth={selected ? 2.5 : 1.25}
                  className={cn(
                    "cursor-grab",
                    selected ? "fill-accent stroke-primary" : "fill-muted stroke-border",
                  )}
                  onPointerDown={(e) => beginDrag(e, instance)}
                />
              ) : (
                // No geometry (the instance's own config is invalid) — a marker
                // at the pose so it stays selectable/draggable to be fixed (I5).
                <rect
                  x={instance.placement.pose.origin_mm.x - handleR}
                  y={instance.placement.pose.origin_mm.y - handleR}
                  width={handleR * 2}
                  height={handleR * 2}
                  vectorEffect="non-scaling-stroke"
                  strokeWidth={2}
                  strokeDasharray="4 3"
                  className="fill-destructive/15 stroke-destructive cursor-grab"
                  onPointerDown={(e) => beginDrag(e, instance)}
                />
              )}
              <text
                x={instance.footprint?.labelAt.x ?? instance.placement.pose.origin_mm.x}
                y={instance.footprint?.labelAt.y ?? instance.placement.pose.origin_mm.y}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={fontSize}
                className="fill-foreground pointer-events-none select-none"
              >
                {label}
              </text>
            </g>
          );
        })}

        {instances.flatMap((instance) =>
          instance.ports
            .filter((port) => port.at !== undefined)
            .map((port) => {
              const isSource =
                connectFrom?.instanceId === instance.instanceId &&
                connectFrom.portId === port.portId;
              const isTarget =
                source !== undefined &&
                !source.used &&
                instance.instanceId !== connectFrom?.instanceId &&
                !port.used &&
                portsCompatible(source, port);
              // A used port already joins a neighbour (I7) — it cannot start or
              // receive a new connection, so it is inert (matched by its cursor).
              const inert = port.used && !isSource;
              return (
                <circle
                  key={`${instance.instanceId}#${port.portId}`}
                  cx={port.at!.x}
                  cy={port.at!.y}
                  r={isSource || isTarget ? handleR * 1.25 : handleR * 0.85}
                  vectorEffect="non-scaling-stroke"
                  strokeWidth={isSource || isTarget ? 2.5 : 1.5}
                  className={cn(
                    inert ? "cursor-not-allowed" : "cursor-pointer",
                    isSource
                      ? "fill-primary stroke-primary"
                      : isTarget
                        ? "fill-background stroke-primary"
                        : port.used
                          ? "fill-muted-foreground stroke-border"
                          : "fill-background stroke-border",
                  )}
                  aria-label={t("port", { instance: instance.instanceId, port: port.portId })}
                  role="button"
                  onPointerDown={(e) => {
                    if (inert) return;
                    e.stopPropagation();
                    onPortClick(instance.instanceId, port.portId);
                  }}
                />
              );
            }),
        )}
      </svg>

      {instances.length === 0 && (
        <p className="text-muted-foreground pointer-events-none absolute inset-0 flex items-center justify-center text-sm">
          {t("emptyPlan")}
        </p>
      )}
    </div>
  );
}
