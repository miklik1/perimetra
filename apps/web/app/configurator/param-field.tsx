"use client";

import { useId } from "react";

import { useTranslations } from "@repo/i18n/web";
import type { OptionSet, ParameterDef, Value } from "@repo/model";
import { Badge } from "@repo/ui";

/**
 * One generated form field (CORE_SPEC §8): everything rendered here comes off
 * the release data — label, input kind, domain bounds, select options. The
 * type decides the control; an enum domain or a matching option set turns any
 * type into a select (the option set is THE source for `fill_type_id`-style
 * params, with vendor-authored option labels).
 *
 * `value` is what the user typed (absent = engine default applies);
 * `effective` is the post-cascade value from the engine scope. Clearing a
 * field hands the value back to the default — shown with a badge instead of
 * pretending the user typed it.
 */
export interface ParamFieldProps {
  def: ParameterDef;
  optionSets: OptionSet[];
  value: Value | undefined;
  effective: Value | undefined;
  onChange: (value: Value | undefined) => void;
}

const inputClass =
  "border-border bg-chrome-subtle focus-visible:ring-copper w-full rounded-lg border px-3 py-2 text-sm outline-none focus-visible:ring-2";

export function ParamField({ def, optionSets, value, effective, onChange }: ParamFieldProps) {
  const t = useTranslations("configurator");
  const id = useId();
  const label = def.label ?? def.key;
  const isDefault = value === undefined && effective !== undefined;
  const shown = value ?? effective;

  const numeric = def.type === "length_mm" || def.type === "int";
  const optionSet = optionSets.find((set) => set.selectedBy === def.key);
  const enumValues = def.domain?.kind === "enum" ? def.domain.values : undefined;
  const range = def.domain?.kind === "range" ? def.domain : undefined;

  let control: React.ReactNode;
  if (def.type === "bool") {
    control = (
      <input
        id={id}
        type="checkbox"
        checked={Boolean(shown)}
        onChange={(e) => onChange(e.target.checked)}
        className="border-border size-4 rounded border"
      />
    );
  } else if (optionSet !== undefined) {
    control = (
      <select
        id={id}
        value={String(shown ?? "")}
        onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
        className={inputClass}
      >
        <option value="" />
        {optionSet.options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label ?? o.id}
          </option>
        ))}
      </select>
    );
  } else if (enumValues !== undefined) {
    control = (
      <select
        id={id}
        value={String(shown ?? "")}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "") onChange(undefined);
          else onChange(numeric ? Number(v) : v);
        }}
        className={inputClass}
      >
        <option value="" />
        {enumValues.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    );
  } else if (numeric) {
    control = (
      <input
        id={id}
        type="number"
        value={shown === undefined ? "" : String(shown)}
        min={range?.min}
        max={range?.max}
        step={range?.step}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === "" ? undefined : Number(v));
        }}
        className={inputClass}
      />
    );
  } else {
    control = (
      <input
        id={id}
        type="text"
        value={String(shown ?? "")}
        onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
        className={inputClass}
      />
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="flex items-center gap-2 font-medium">
        <span>
          {label}
          {def.type === "length_mm" && <span className="text-muted-foreground"> (mm)</span>}
        </span>
        {isDefault && <Badge tone="outline">{t("defaultBadge")}</Badge>}
      </label>
      {control}
      {def.deviation?.note !== undefined && (
        <p className="text-muted-foreground text-xs">{def.deviation.note}</p>
      )}
    </div>
  );
}
