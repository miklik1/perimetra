import {
  useFieldArray,
  type Control,
  type FieldArray,
  type FieldArrayPath,
  type FieldValues,
} from "react-hook-form";
import * as React from "react";

import { cn } from "@repo/ui/lib/utils";

import { Button } from "../components/ui/button";

/**
 * Typed `useFieldArray` repeater — the repo's first array-field primitive. Powers
 * the editor's parameters / constraints / derived / geometry lists: add, remove,
 * and reorder (move up/down — accessible, keyboard-reachable; drag is a later
 * polish). The row body is a render prop; rows are keyed by the stable
 * `useFieldArray` field id so React reconciles cleanly as rows move.
 *
 * Order matters in the model (a `derived[i]` sees only EARLIER derived), so
 * reorder is first-class — moving a row that breaks a forward reference surfaces
 * the `ref.unknown` defect live.
 */
export interface ArrayFieldRenderArgs {
  index: number;
  remove: () => void;
  /** undefined for the first row. */
  moveUp: (() => void) | undefined;
  /** undefined for the last row. */
  moveDown: (() => void) | undefined;
}

export interface ArrayFieldProps<
  TFieldValues extends FieldValues,
  TName extends FieldArrayPath<TFieldValues>,
> {
  control: Control<TFieldValues>;
  name: TName;
  /** Factory for a new row's default value. */
  makeDefault: () => FieldArray<TFieldValues, TName>;
  addLabel: string;
  /** Shown in place of the list when there are no rows. */
  emptyLabel?: React.ReactNode;
  /** Hide the up/down controls when order is irrelevant. */
  reorderable?: boolean;
  className?: string;
  children: (args: ArrayFieldRenderArgs) => React.ReactNode;
}

export function ArrayField<
  TFieldValues extends FieldValues,
  TName extends FieldArrayPath<TFieldValues>,
>({
  control,
  name,
  makeDefault,
  addLabel,
  emptyLabel,
  reorderable = true,
  className,
  children,
}: ArrayFieldProps<TFieldValues, TName>) {
  const { fields, append, remove, move } = useFieldArray({ control, name });

  return (
    <div className={cn("flex flex-col gap-2", className)} data-slot="array-field">
      {fields.length === 0 && emptyLabel ? (
        <p className="text-muted-foreground text-sm">{emptyLabel}</p>
      ) : null}
      {fields.map((field, index) => (
        <div key={field.id} className="border-border flex items-start gap-2 rounded-md border p-2">
          <div className="min-w-0 flex-1">
            {children({
              index,
              remove: () => remove(index),
              moveUp: reorderable && index > 0 ? () => move(index, index - 1) : undefined,
              moveDown:
                reorderable && index < fields.length - 1 ? () => move(index, index + 1) : undefined,
            })}
          </div>
          <div className="flex shrink-0 flex-col gap-1">
            {reorderable ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Move up"
                  disabled={index === 0}
                  onClick={() => move(index, index - 1)}
                >
                  ↑
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Move down"
                  disabled={index === fields.length - 1}
                  onClick={() => move(index, index + 1)}
                >
                  ↓
                </Button>
              </>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label="Remove"
              onClick={() => remove(index)}
            >
              ✕
            </Button>
          </div>
        </div>
      ))}
      <div>
        <Button type="button" variant="outline" size="sm" onClick={() => append(makeDefault())}>
          {addLabel}
        </Button>
      </div>
    </div>
  );
}
