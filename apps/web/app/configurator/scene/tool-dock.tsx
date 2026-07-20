"use client";

import { useTranslations } from "@repo/i18n/web";
import { Icon, IconButton, type IconName } from "@repo/ui";

import { useExplode } from "./explode";
import { useManipulation } from "./manipulation";
import { useSection } from "./section";

/**
 * The immersive editor's tool dock (ADR 0116, `design/configurator/frames-v2.jsx`
 * `toolDock()`): a floating vertical toolbar that replaces the banded viewport's
 * top-left explode/section cluster while the scene is edge-to-edge.
 *
 * Two of the six tools drive the manipulation store (Výběr picks parts, Kóty
 * suppresses picking so the pills/handles can be worked without selecting); two
 * delegate to the existing overlay slices (Řez → `useSection`, Rozklad →
 * `useExplode`), so their state stays single-sourced; and two — Měřit, Otočit —
 * are deferred (ADR 0116, Martin's scope call) and render as disabled
 * affordances rather than being hidden, so the tool set the canvas draws is
 * visible and the deferral is legible.
 *
 * A real toolbar (§12.1): `role="toolbar"`, `aria-pressed` on the toggles, an
 * `aria-label` on every button, and no reliance on the native `title`.
 */
export function ToolDock({ canExplode }: { canExplode: boolean }): React.JSX.Element {
  const t = useTranslations("configurator");
  const tool = useManipulation((s) => s.tool);
  const setTool = useManipulation((s) => s.setTool);
  const sectionEnabled = useSection((s) => s.enabled);
  const toggleSection = useSection((s) => s.toggle);
  const explodeTarget = useExplode((s) => s.target);
  const toggleExplode = useExplode((s) => s.toggle);
  const explodeActive = explodeTarget > 0 && canExplode;

  return (
    <div
      role="toolbar"
      aria-orientation="vertical"
      aria-label={t("toolsLabel")}
      className="bg-chrome shadow-float rounded-control absolute left-4 top-1/2 flex -translate-y-1/2 flex-col gap-1.5 p-1.5"
    >
      <DockTool
        icon="center"
        label={t("toolSelect")}
        active={tool === "select"}
        onClick={() => setTool("select")}
      />
      <DockTool
        icon="ruler"
        label={t("toolDim")}
        active={tool === "dim"}
        onClick={() => setTool("dim")}
      />
      <DockTool
        icon="section"
        label={t("section")}
        active={sectionEnabled}
        onClick={toggleSection}
      />
      <DockTool
        icon="explode"
        label={t("explode")}
        active={explodeActive}
        disabled={!canExplode}
        onClick={toggleExplode}
      />
      <DockTool icon="scale" label={t("toolMeasure")} disabled />
      <DockTool icon="reproduce" label={t("toolRotate")} disabled />
    </div>
  );
}

/** One dock button. `active` toggles the near-black fill (a pressed toggle);
 *  `disabled` is the deferred-tool affordance. */
function DockTool({
  icon,
  label,
  active = false,
  disabled = false,
  onClick,
}: {
  icon: IconName;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}): React.JSX.Element {
  return (
    <IconButton
      size="md"
      active={active}
      disabled={disabled}
      aria-pressed={onClick !== undefined ? active : undefined}
      aria-label={label}
      onClick={onClick}
      className="pointer-coarse:size-11"
    >
      <Icon name={icon} size={18} />
    </IconButton>
  );
}
