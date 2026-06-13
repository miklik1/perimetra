"use client";

import { useId } from "react";

import type { ConfigInput } from "@repo/engine";
import { useTranslations } from "@repo/i18n/web";
import type { ResolvedUiStep, Scope, Site, Value } from "@repo/model";
import { Button } from "@repo/ui";

import { Wizard } from "../configurator/wizard";
import type { InstanceUi } from "./derive";
import { IssueList } from "./issue-list";

/**
 * The selected instance's editor: pose controls (rotate, terrain segment) plus
 * the SAME generated wizard the configurator renders — zero product knowledge,
 * driven entirely by the release's resolved UiSpec. Per-instance issues surface
 * here (terrain-injected), while the site panel carries the aggregate.
 */
export interface InstancePanelProps {
  instance: InstanceUi;
  input: ConfigInput;
  site: Site;
  steps: ResolvedUiStep[];
  stepIndex: number;
  scope: Scope | undefined;
  onStepChange: (index: number) => void;
  onValueChange: (key: string, value: Value | undefined) => void;
  onRotate: () => void;
  onAssignSegment: (segmentId: string | undefined) => void;
  onRemove: () => void;
}

export function InstancePanel({
  instance,
  input,
  site,
  steps,
  stepIndex,
  scope,
  onStepChange,
  onValueChange,
  onRotate,
  onAssignSegment,
  onRemove,
}: InstancePanelProps) {
  const t = useTranslations("site");
  const segmentSelectId = useId();
  const { release } = instance.product;

  return (
    <section className="flex flex-col gap-3">
      <div className="border-border flex items-center justify-between gap-2 rounded-md border p-3 text-sm">
        <span className="font-semibold">
          {release.modelId} · {instance.instanceId}
        </span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onRotate}>
            {t("rotate")}
          </Button>
          <Button variant="outline" size="sm" onClick={onRemove}>
            {t("delete")}
          </Button>
        </div>
      </div>

      {release.terrain !== undefined && (
        <div className="border-border flex items-center gap-2 rounded-md border p-3 text-sm">
          <label htmlFor={segmentSelectId} className="text-muted-foreground">
            {t("standsOn")}
          </label>
          <select
            id={segmentSelectId}
            value={instance.placement.terrainSegmentId ?? ""}
            onChange={(e) => onAssignSegment(e.target.value === "" ? undefined : e.target.value)}
            className="border-border bg-background rounded-md border px-2 py-1"
          >
            <option value="">{t("segmentNone")}</option>
            {site.terrain.map((segment) => (
              <option key={segment.id} value={segment.id}>
                {segment.id} ({segment.elevation_mm} mm)
              </option>
            ))}
          </select>
        </div>
      )}

      {instance.result?.issues !== undefined && instance.result.issues.length > 0 && (
        <div className="border-border flex flex-col gap-1 rounded-md border p-3 text-sm">
          <h3 className="font-semibold">{t("issues")}</h3>
          <IssueList issues={instance.result.issues} />
        </div>
      )}

      <Wizard
        release={release}
        steps={steps}
        stepIndex={stepIndex}
        input={input}
        scope={scope}
        onStepChange={onStepChange}
        onValueChange={onValueChange}
      />
    </section>
  );
}
