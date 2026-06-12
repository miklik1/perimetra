"use client";

import { useTranslations } from "@repo/i18n/web";
import type { ConfigInput } from "@repo/engine";
import type { ProductModelRelease, ResolvedUiStep, Scope, Value } from "@repo/model";
import { Button, cn } from "@repo/ui";

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
    <section className="border-border flex flex-col gap-4 rounded-md border p-4 text-sm">
      <nav className="flex flex-wrap gap-1" aria-label={t("title")}>
        {steps.map((s, i) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onStepChange(i)}
            aria-current={i === stepIndex ? "step" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium",
              i === stepIndex
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            {s.label ?? s.id}
          </button>
        ))}
      </nav>

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

      <div className="flex justify-between">
        <Button
          variant="outline"
          size="sm"
          disabled={stepIndex === 0}
          onClick={() => onStepChange(stepIndex - 1)}
        >
          {t("back")}
        </Button>
        <Button
          size="sm"
          disabled={stepIndex >= steps.length - 1}
          onClick={() => onStepChange(stepIndex + 1)}
        >
          {t("next")}
        </Button>
      </div>
    </section>
  );
}
