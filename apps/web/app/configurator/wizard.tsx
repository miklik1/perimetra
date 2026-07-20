"use client";

import type { ConfigInput } from "@repo/engine";
import { useTranslations } from "@repo/i18n/web";
import type { ProductModelRelease, ResolvedUiStep, Scope, Value } from "@repo/model";
import { Button, Panel, StepNav } from "@repo/ui";

import { ParamField } from "./param-field";

/**
 * The generated wizard (CORE_SPEC §8): steps, groups, labels, and field order
 * come from the release's resolved UiSpec — this component contains ZERO
 * product knowledge. Relevance-hidden parameters drop out of the rendered
 * groups while step indices stay stable (resolveUi returns the full
 * structure); a group with nothing visible disappears with them.
 */
export interface WizardProps {
  release: ProductModelRelease;
  steps: ResolvedUiStep[];
  stepIndex: number;
  input: ConfigInput;
  scope: Scope | undefined;
  onStepChange: (index: number) => void;
  onValueChange: (key: string, value: Value | undefined) => void;
}

export function Wizard({
  release,
  steps,
  stepIndex,
  input,
  scope,
  onStepChange,
  onValueChange,
}: WizardProps) {
  const t = useTranslations("configurator");
  const step = steps[stepIndex] ?? steps[0];
  if (step === undefined) return null;

  return (
    <Panel className="flex flex-col gap-5 text-sm" elevation="flat">
      <StepNav
        aria-label={t("title")}
        value={steps[stepIndex]?.id}
        onValueChange={(id) => {
          const next = steps.findIndex((s) => s.id === id);
          if (next !== -1) onStepChange(next);
        }}
      >
        {steps.map((s) => (
          <StepNav.Item key={s.id} value={s.id}>
            <StepNav.Label>{s.label ?? s.id}</StepNav.Label>
          </StepNav.Item>
        ))}
      </StepNav>

      {step.groups.map((group) => {
        const visible = group.params.filter((p) => p.visible);
        if (visible.length === 0) return null;
        return (
          <fieldset key={group.id} className="flex flex-col gap-3">
            {group.label !== undefined && (
              <legend className="text-muted-foreground mb-2 text-xs font-semibold uppercase">
                {group.label}
              </legend>
            )}
            {visible.map(({ def }) => (
              <ParamField
                key={def.key}
                def={def}
                optionSets={release.optionSets ?? []}
                value={input[def.key]}
                effective={scope?.[def.key]}
                onChange={(value) => onValueChange(def.key, value)}
              />
            ))}
          </fieldset>
        );
      })}

      <div className="flex justify-between pt-1">
        <Button
          variant="outline"
          size="sm"
          disabled={stepIndex === 0}
          onClick={() => onStepChange(stepIndex - 1)}
        >
          {t("back")}
        </Button>
        <Button
          variant="copper"
          size="sm"
          disabled={stepIndex >= steps.length - 1}
          onClick={() => onStepChange(stepIndex + 1)}
        >
          {t("next")}
        </Button>
      </div>
    </Panel>
  );
}
