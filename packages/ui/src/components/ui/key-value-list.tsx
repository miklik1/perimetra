import * as React from "react";

import { cn } from "@repo/ui/lib/utils";

/**
 * The spec-row shape (design/README.md §9.4) — muted key on the left, a
 * `font-data tabular-nums` value on the right, a hairline between rows but
 * NEVER after the last. Six screens draw it (configurator summary, lead recap,
 * quote spec, order spec, customer tab, print spec), so it is a kit primitive
 * rather than six hand-rolled `<dl>` grids.
 *
 * Rendered as a real description list (`dl`/`dt`/`dd`) so assistive tech gets
 * the key→value association for free; each row is an HTML5 `div` grouping,
 * which the spec explicitly allows inside `<dl>`.
 *
 * The separator is the ROOT's business: a `:not(:last-child)` bottom border
 * applied from the root's own class string. Callers never insert a
 * `<Separator>` between rows and rows never wrap themselves in a divider
 * element — that is what makes "no rule after the last row" structural instead
 * of a counting exercise at every call site.
 *
 * The context here is a COMPOSITION GUARD only — it carries no value, it just
 * makes a stray `<KeyValueList.Row>` throw instead of emitting a `dt` outside
 * any list (which would be invalid HTML and silently unstyled).
 *
 * Canvas source: design/configurator/frames-v2.jsx:270-274 (`priceRow` — flex
 * space-between, baseline aligned, `text-muted-foreground` key,
 * `font-data tabular-nums` value).
 */
const KeyValueListContext = React.createContext<boolean>(false);

function useKeyValueListGuard(part: string): void {
  if (!React.use(KeyValueListContext)) {
    throw new Error(`<KeyValueList.${part}> must be rendered inside <KeyValueList>.`);
  }
}

function KeyValueListRoot({ className, children, ...props }: React.ComponentProps<"dl">) {
  return (
    <KeyValueListContext value={true}>
      <dl
        data-slot="key-value-list"
        className={cn(
          "text-ui-base [&>*:not(:last-child)]:border-border [&>*:not(:last-child)]:border-b",
          className,
        )}
        {...props}
      >
        {children}
      </dl>
    </KeyValueListContext>
  );
}

/**
 * One key→value pair. `label` is a config prop because it IS the `<dt>` content
 * and a two-cell row has exactly one other slot (children → `<dd>`); a
 * `<KeyValueList.Key>` part would buy nothing but ceremony at six call sites.
 * It takes `React.ReactNode`, so a label may carry an icon, a unit or a
 * tooltip trigger.
 *
 * `mono` picks the value's rendering REGISTER — `font-data tabular-nums` (the
 * default, so numeric columns align digit-for-digit down the list) versus
 * `font-mono` for opaque identifiers and codes such as `AL-PRF-40`. It is not a
 * layout or behaviour switch: nothing about the row's structure changes, so it
 * does not fall under the no-boolean-props rule.
 *
 * Layout is flex + `items-baseline` (matching the canvas) rather than a grid:
 * the key is `shrink-0` and the value takes the remaining track with
 * `min-w-0 break-words`, so a long value wraps inside its own column instead of
 * pushing the key column out of alignment with the rows above it.
 */
function KeyValueListRow({
  className,
  label,
  mono = false,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & {
  label: React.ReactNode;
  mono?: boolean;
  children?: React.ReactNode;
}) {
  useKeyValueListGuard("Row");
  return (
    <div
      data-slot="key-value-list-row"
      className={cn("flex items-baseline justify-between gap-4 py-1.5", className)}
      {...props}
    >
      <dt data-slot="key-value-list-key" className="text-muted-foreground shrink-0">
        {label}
      </dt>
      <dd
        data-slot="key-value-list-value"
        data-register={mono ? "mono" : "data"}
        className={cn(
          "min-w-0 flex-1 break-words text-right font-medium",
          mono ? "font-mono" : "font-data tabular-nums",
        )}
      >
        {children}
      </dd>
    </div>
  );
}

const KeyValueList = Object.assign(KeyValueListRoot, {
  Row: KeyValueListRow,
});

export { KeyValueList };
