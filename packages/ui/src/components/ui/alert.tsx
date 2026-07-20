import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@repo/ui/lib/utils";

import { Icon, type IconName } from "./icon";

/**
 * The four banner tones. This vocabulary is the SAME four status tones `Badge`
 * exposes (`badge.tsx`) and is deliberately a strict subset of it: a persistent
 * banner is always a status statement, never a neutral/outline label and never
 * the CORE_SPEC §6 `deviation` signal (that one belongs on a value, not on a
 * page-level notice). Keeping the names identical is what stops the two
 * vocabularies from drifting — a `warning` badge and a `warning` alert must
 * always mean the same thing (`design/README.md` §9.3).
 */
type AlertTone = "info" | "success" | "warning" | "destructive";

/**
 * Persistent in-page banner (`design/README.md` §8.1, §9.3). `Toast` is
 * transient-only, so before this existed app-land wrote bare
 * `<p className="text-destructive" role="alert">` for states that must STAY on
 * screen — catalog unavailable, no active price table (the "empty-but-honest"
 * posture: a notice, never a zero), the workshop 403 on `/price-tables/active`.
 *
 * The visual model is ported from the canvas' margin-below-floor block
 * (`design/configurator/frames-v2.jsx:260-261`): a `-subtle` tint fill, a
 * tone-coloured semibold heading line prefixed by the tone glyph, and the
 * detail text below it. The border is the solid tone at low alpha so the
 * banner keeps an edge on both the chrome and the chrome-subtle field.
 *
 * Layout is a three-column grid — icon / content / action — placed by explicit
 * `col-start`/`row-start` on each part rather than by wrapper elements, so the
 * consumer's JSX stays flat and matches the documented API exactly. Which slots
 * are filled IS the variant: no `showIcon`, no `hasAction`.
 */
const alertVariants = cva(
  "text-ui-base ease-brand focus-visible:ring-ring grid grid-cols-[auto_1fr_auto] gap-x-3 rounded-card border p-4 outline-none transition-colors duration-200 focus-visible:ring-2",
  {
    variants: {
      tone: {
        info: "bg-info-subtle border-info/25",
        success: "bg-success-subtle border-success/25",
        warning: "bg-warning-subtle border-warning/25",
        destructive: "bg-destructive-subtle border-destructive/25",
      },
    },
    defaultVariants: {
      tone: "info",
    },
  },
);

/**
 * Ink for the GLYPH only. The title deliberately does not use this — see
 * `AlertTitle` for the contrast measurements that decided it. The glyph keeps
 * the tone because it is decorative (`aria-hidden`) and fully redundant with the
 * title text and the live-region role, so it carries no meaning that colour
 * alone must convey.
 */
const TONE_INK: Record<AlertTone, string> = {
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
};

/**
 * Default glyph per tone, from the `Icon` registry. `warn` (the triangle) covers
 * both attention tones; `check` closes a success; `list` reads as "here is some
 * information" without pretending to be an italic-i badge the set doesn't own.
 * Any of these can be replaced by passing children to `<Alert.Icon>` — e.g. the
 * workshop price-blind 403 is better said with `lock`.
 */
const TONE_GLYPH: Record<AlertTone, IconName> = {
  info: "list",
  success: "check",
  warning: "warn",
  destructive: "warn",
};

/**
 * Live-region politeness is DERIVED from the tone, never taken as a prop: an
 * `alert` role interrupts the screen-reader user immediately, which is correct
 * for a problem (`destructive`) or a blocked state (`warning`) and rude for a
 * confirmation or a hint (`success`/`info`, which announce politely as
 * `status`). Exposing that as a prop would only create banners whose urgency
 * contradicts their colour.
 */
function roleForTone(tone: AlertTone): "alert" | "status" {
  return tone === "destructive" || tone === "warning" ? "alert" : "status";
}

/**
 * Composition guard AND the tone channel: parts read the tone from here instead
 * of taking it again as a prop (one source of truth per banner), and a part
 * rendered outside a root gets `null` and throws with a branded message rather
 * than rendering unstyled in the wild.
 */
const AlertContext = React.createContext<AlertTone | null>(null);

function useAlertTone(part: string): AlertTone {
  const tone = React.use(AlertContext);
  if (tone === null) {
    throw new Error(`<Alert.${part}> must be rendered inside <Alert>.`);
  }
  return tone;
}

function AlertRoot({
  className,
  tone,
  children,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  const resolved: AlertTone = tone ?? "info";

  return (
    <AlertContext value={resolved}>
      <div
        data-slot="alert"
        data-tone={resolved}
        role={roleForTone(resolved)}
        className={cn(alertVariants({ tone: resolved, className }))}
        {...props}
      >
        {children}
      </div>
    </AlertContext>
  );
}

/**
 * The leading glyph. It is DECORATIVE (`aria-hidden`) on purpose: the tone is
 * carried by the title text and by the live-region role, never by colour or by
 * a shape alone, so hiding it from assistive tech loses nothing and saves a
 * meaningless announcement. Children override the default glyph.
 */
function AlertIcon({ className, children, ...props }: React.ComponentProps<"span">) {
  const tone = useAlertTone("Icon");

  return (
    <span
      data-slot="alert-icon"
      aria-hidden={true}
      className={cn(
        // h-5 == the `text-ui-md` line box of the title, so the glyph centres
        // on the first line of the heading rather than on the whole banner.
        "col-start-1 row-start-1 inline-flex h-5 items-center",
        TONE_INK[tone],
        className,
      )}
      {...props}
    >
      {children ?? <Icon name={TONE_GLYPH[tone]} size={16} />}
    </span>
  );
}

/**
 * The banner's heading line. Renders a real `h3` so the banner is findable in
 * the heading outline — a persistent notice is a section of the page, unlike a
 * toast.
 *
 * The title ink is `text-foreground`, NOT the tone. The canvas colours this line
 * with the solid tone, and that fails WCAG AA badly in light mode: the solid
 * status tokens are tuned to carry WHITE text (each ships its own `-foreground`
 * counterpart for exactly that), so putting them ON their own pale `-subtle`
 * fill measures 2.02:1 for `warning`, 2.91:1 for `success` and 3.14:1 for `info`
 * against a 4.5:1 requirement. The derived `-active` ink was also measured and
 * still falls short in light (3.16 / 4.28 / 4.53). `text-foreground` measures
 * 12.2-15.8:1 in BOTH themes and stays correct if the tone tokens are ever
 * retuned, because it is the fill's own contrast partner.
 *
 * The tone is not lost: it is carried by the fill, the border and the glyph, and
 * — for anyone not seeing colour at all — by the derived live-region role and
 * the title text itself. Colour is never the sole carrier here.
 */
function AlertTitle({ className, ...props }: React.ComponentProps<"h3">) {
  useAlertTone("Title");

  return (
    <h3
      data-slot="alert-title"
      className={cn("text-ui-md text-foreground col-start-2 row-start-1 font-semibold", className)}
      {...props}
    />
  );
}

/** The detail line under the title — muted, so the title keeps the emphasis. */
function AlertDescription({ className, ...props }: React.ComponentProps<"p">) {
  useAlertTone("Description");

  return (
    <p
      data-slot="alert-description"
      className={cn("text-muted-foreground col-start-2 row-start-2 mt-1", className)}
      {...props}
    />
  );
}

/**
 * Trailing slot for the one remedy the banner offers (a `Button`, a link). It
 * spans both content rows and centres itself, so it sits level with the block
 * whether or not a description is present.
 */
function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  useAlertTone("Action");

  return (
    <div
      data-slot="alert-action"
      className={cn(
        "col-start-3 row-span-2 row-start-1 flex items-center self-center pl-2",
        className,
      )}
      {...props}
    />
  );
}

const Alert = Object.assign(AlertRoot, {
  Icon: AlertIcon,
  Title: AlertTitle,
  Description: AlertDescription,
  Action: AlertAction,
});

export { Alert, alertVariants };
export type { AlertTone };
