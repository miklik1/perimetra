import * as React from "react";

import { cn } from "@repo/ui/lib/utils";

import { fieldInputClass } from "./field-shell";

/**
 * A typed native `<select>` bound to a string-literal union — the editor uses it
 * for every closed enum field (`ParamType`, `Adjustability`, `DeviationMode`,
 * `ConstraintDef.kind`/`severity`/`scope`, BOM unit/category). Controlled;
 * `onChange` hands back the narrowed value, never a raw event.
 */
export interface EnumSelectOption<T extends string> {
  value: T;
  label?: string;
}

export interface EnumSelectProps<T extends string> extends Omit<
  React.ComponentProps<"select">,
  "value" | "onChange"
> {
  value: T;
  onChange: (value: T) => void;
  options: readonly EnumSelectOption<T>[];
}

export function EnumSelect<T extends string>({
  value,
  onChange,
  options,
  className,
  ...props
}: EnumSelectProps<T>) {
  return (
    <select
      {...props}
      data-slot="enum-select"
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className={cn(fieldInputClass, className)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label ?? option.value}
        </option>
      ))}
    </select>
  );
}
