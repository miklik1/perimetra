"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import { useApiClient, useMutation } from "@repo/api/react";
import { AuthGuard } from "@repo/auth/react";
import { useTranslations } from "@repo/i18n/web";
import { resolveUi, type Site, type Value } from "@repo/model";
import { Button } from "@repo/ui";

import { errorMessageKey } from "../../lib/error-messages";
import { createProjectsQueries } from "../../lib/projects-queries";
import { toast } from "../../lib/toast";
import { usePriceBlind } from "../../lib/use-role";
import { products } from "../configurator/products";
import { SceneViewport } from "../configurator/scene/scene-viewport";
import {
  deriveInstanceScope,
  deriveSiteForUi,
  portsCompatible,
  releaseOf,
  type PlacedInstance,
} from "./derive";
import { initialInstances as demoInstances, initialSite as demoSite } from "./initial";
import { InstancePanel } from "./instance-panel";
import { Palette } from "./palette";
import { toSavePayload } from "./persistence";
import { PlanCanvas } from "./plan-canvas";
import { SiteResultsPanel } from "./site-results-panel";
import { TerrainPanel } from "./terrain-panel";

const QUARTER_TURN = 5400; // arc-minutes (I10)
const FULL_TURN = 21600;
const PLACE_SPACING_MM = 6000;

/**
 * The site canvas (CORE_SPEC §8, step 6 slice 2): the generated configurator at
 * SITE scope (I11). The user places vendor releases, drags their poses,
 * connects their ports, and assigns terrain — and the whole site re-derives in
 * the browser per edit (the engine is pure — I1 — so the client is a valid
 * host). Two truths kept apart so editing never dead-ends: the aggregate
 * BOM/price/3D render off the one `deriveSite` when valid, while per-instance
 * footprints stay draggable even when a bad connection invalidates the site.
 * Gated like every tenant surface (proxy prefix + AuthGuard).
 *
 * Project-scoped (step 6.3c): the canvas opens on the saved project (loaded by
 * the RSC and prop-passed as `initialSite` + `initialInstances`) and saves the
 * whole site + roster back with one PUT. Edits stay local React state until
 * Save — the engine re-derives per edit (pure, I1), but persistence is explicit.
 */
export function SiteClient({
  projectId,
  initialSite,
  initialInstances,
}: {
  projectId: string;
  initialSite: Site;
  initialInstances: PlacedInstance[];
}) {
  const router = useRouter();
  const t = useTranslations("site");
  const tErrors = useTranslations("errors");

  const [site, setSite] = useState<Site>(initialSite);
  const [instances, setInstances] = useState<PlacedInstance[]>(initialInstances);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [connectFrom, setConnectFrom] = useState<
    { instanceId: string; portId: string } | undefined
  >();
  const [stepByInstance, setStepByInstance] = useState<Record<string, number>>({});
  const idCounter = useRef(0);

  // Dirty tracking against the last-persisted document: serialize the save
  // payload and compare. The engine already re-serializes the whole site per
  // edit, so this stringify is cheap at the slice's scale.
  const projectsQueries = createProjectsQueries(useApiClient());
  const [savedSnapshot, setSavedSnapshot] = useState(() =>
    JSON.stringify(toSavePayload(initialSite, initialInstances)),
  );
  const currentPayload = useMemo(() => toSavePayload(site, instances), [site, instances]);
  const dirty = JSON.stringify(currentPayload) !== savedSnapshot;

  const saveMutation = useMutation({
    ...projectsQueries.saveSite(),
    onError: (error) => toast.error(tErrors(errorMessageKey(error))),
  });

  const save = () => {
    const payload = currentPayload;
    saveMutation.mutate(
      { projectId, input: payload },
      {
        onSuccess: () => {
          setSavedSnapshot(JSON.stringify(payload));
          toast.success(t("saved"));
        },
      },
    );
  };

  // Load demo: drop the golden fixtures roster into this project (unsaved until
  // the user clicks Save) — the interim convenience while releases live in
  // @repo/fixtures rather than an api-served catalog.
  const loadDemo = () => {
    setSite(demoSite());
    setInstances(demoInstances());
    setSelectedId(undefined);
    setConnectFrom(undefined);
    setStepByInstance({});
  };

  // One full site re-derivation per edit (incl. each drag frame). The engine is
  // pure and fast, so this is fine at the slice's scale; for large sites the
  // aggregate (BOM/3D) could be deferred to drag-end while footprints update
  // live. The selected instance is derived once more below for its form scope —
  // the same split the configurator uses (scope isn't on SiteResult).
  const derivation = useMemo(() => deriveSiteForUi(site, instances), [site, instances]);
  // FE mirror of the server price-blind rule (ADR 0056) — workshop sees no money.
  const priceBlind = usePriceBlind();

  const selectedPlaced = instances.find((i) => i.instanceId === selectedId);
  const selectedUi = derivation.instances.find((i) => i.instanceId === selectedId);
  const selectedDerive = useMemo(
    () => (selectedPlaced ? deriveInstanceScope(site, selectedPlaced) : undefined),
    [site, selectedPlaced],
  );
  const selectedSteps = useMemo(
    () =>
      selectedPlaced
        ? resolveUi(releaseOf(selectedPlaced), selectedDerive?.scope ?? selectedPlaced.input)
        : [],
    [selectedPlaced, selectedDerive],
  );

  const newId = (modelId: string) => {
    const used = new Set(instances.map((i) => i.instanceId));
    let n = idCounter.current + 1;
    while (used.has(`${modelId}-${n}`)) n += 1;
    idCounter.current = n;
    return `${modelId}-${n}`;
  };

  const selectInstance = (id?: string) => {
    setSelectedId(id);
    setConnectFrom(undefined);
  };

  const addInstance = (productIndex: number) => {
    const product = products[productIndex]!;
    const id = newId(product.release.modelId);
    setInstances((prev) => [
      ...prev,
      { instanceId: id, productIndex, input: { ...product.initialInput } },
    ]);
    setSite((prev) => {
      // Compute the offset off the latest placements (inside the updater), so a
      // rapid double-add can't place two instances at the same origin.
      const nextX =
        prev.placements.reduce((m, p) => Math.max(m, p.pose.origin_mm.x), -PLACE_SPACING_MM) +
        PLACE_SPACING_MM;
      return {
        ...prev,
        placements: [
          ...prev.placements,
          { instanceId: id, pose: { origin_mm: { x: nextX, y: 0 } } },
        ],
      };
    });
    selectInstance(id);
  };

  const removeInstance = (id: string) => {
    setInstances((prev) => prev.filter((i) => i.instanceId !== id));
    setSite((prev) => ({
      ...prev,
      placements: prev.placements.filter((p) => p.instanceId !== id),
      connections: prev.connections.filter((c) => c.a.instanceId !== id && c.b.instanceId !== id),
    }));
    setSelectedId((cur) => (cur === id ? undefined : cur));
    setConnectFrom((cur) => (cur?.instanceId === id ? undefined : cur));
    setStepByInstance((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const moveInstance = (id: string, origin: { x: number; y: number }) => {
    setSite((prev) => ({
      ...prev,
      placements: prev.placements.map((p) =>
        p.instanceId === id ? { ...p, pose: { ...p.pose, origin_mm: origin } } : p,
      ),
    }));
  };

  const rotateSelected = () => {
    if (selectedId === undefined) return;
    setSite((prev) => ({
      ...prev,
      placements: prev.placements.map((p) =>
        p.instanceId === selectedId
          ? {
              ...p,
              pose: {
                ...p.pose,
                rotationArcMin: ((p.pose.rotationArcMin ?? 0) + QUARTER_TURN) % FULL_TURN,
              },
            }
          : p,
      ),
    }));
  };

  const assignSegment = (segmentId?: string) => {
    if (selectedId === undefined) return;
    setSite((prev) => ({
      ...prev,
      placements: prev.placements.map((p) => {
        if (p.instanceId !== selectedId) return p;
        const next = { ...p };
        if (segmentId === undefined) delete next.terrainSegmentId;
        else next.terrainSegmentId = segmentId;
        return next;
      }),
    }));
  };

  const setSegmentElevation = (segmentId: string, elevationMm: number) => {
    setSite((prev) => ({
      ...prev,
      terrain: prev.terrain.map((s) =>
        s.id === segmentId ? { ...s, elevation_mm: elevationMm } : s,
      ),
    }));
  };

  const setValue = (key: string, value: Value | undefined) => {
    if (selectedId === undefined) return;
    setInstances((prev) =>
      prev.map((i) => {
        if (i.instanceId !== selectedId) return i;
        const input = { ...i.input };
        if (value === undefined) delete input[key];
        else input[key] = value;
        return { ...i, input };
      }),
    );
  };

  const setStep = (index: number) => {
    if (selectedId === undefined) return;
    setStepByInstance((prev) => ({ ...prev, [selectedId]: index }));
  };

  const handlePortClick = (instanceId: string, portId: string) => {
    setSelectedId(instanceId);
    const find = (iid: string, pid: string) =>
      derivation.instances.find((i) => i.instanceId === iid)?.ports.find((p) => p.portId === pid);
    const clicked = find(instanceId, portId);
    // Invariant: connectFrom is always a FREE port or nothing — a used port
    // already joins a neighbour (I7) and can never be a connection source.
    const startOrClear = () =>
      setConnectFrom(clicked !== undefined && !clicked.used ? { instanceId, portId } : undefined);

    if (connectFrom === undefined) {
      startOrClear();
      return;
    }
    if (connectFrom.instanceId === instanceId) {
      // Same instance: re-clicking the source cancels; another port restarts
      // the gesture from it (a port can't connect to its own instance).
      if (connectFrom.portId === portId) setConnectFrom(undefined);
      else startOrClear();
      return;
    }
    const source = find(connectFrom.instanceId, connectFrom.portId);
    if (
      source !== undefined &&
      clicked !== undefined &&
      !source.used &&
      !clicked.used &&
      portsCompatible(source, clicked)
    ) {
      const a = connectFrom;
      setSite((prev) => ({
        ...prev,
        connections: [...prev.connections, { a, b: { instanceId, portId } }],
      }));
      setConnectFrom(undefined);
    } else {
      // Incompatible or taken target — restart from the clicked port if free.
      startOrClear();
    }
  };

  const removeConnection = (index: number) => {
    setSite((prev) => ({
      ...prev,
      connections: prev.connections.filter((_, i) => i !== index),
    }));
  };

  return (
    <AuthGuard
      redirect={() => router.push("/login")}
      fallback={
        <main className="flex min-h-screen items-center justify-center">
          {t("checkingSession")}
        </main>
      }
    >
      <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-4 p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">{t("title")}</h1>
          <div className="flex items-center gap-3">
            <span className="text-muted-foreground text-xs">
              {dirty ? t("unsaved") : t("allSaved")}
            </span>
            <Button type="button" variant="outline" onClick={loadDemo}>
              {t("loadDemo")}
            </Button>
            <Button type="button" onClick={save} disabled={!dirty || saveMutation.isPending}>
              {saveMutation.isPending ? t("saving") : t("save")}
            </Button>
          </div>
        </div>

        <div className="grid items-start gap-6 lg:grid-cols-[360px_1fr]">
          <div className="flex flex-col gap-4">
            <Palette
              products={products}
              instances={derivation.instances}
              selectedId={selectedId}
              onAdd={addInstance}
              onSelect={selectInstance}
              onRemove={removeInstance}
            />
            {selectedPlaced !== undefined && selectedUi !== undefined && (
              <InstancePanel
                instance={selectedUi}
                input={selectedPlaced.input}
                site={site}
                steps={selectedSteps}
                stepIndex={stepByInstance[selectedPlaced.instanceId] ?? 0}
                scope={selectedDerive?.scope}
                onStepChange={setStep}
                onValueChange={setValue}
                onRotate={rotateSelected}
                onAssignSegment={assignSegment}
                onRemove={() => removeInstance(selectedPlaced.instanceId)}
              />
            )}
            <TerrainPanel terrain={site.terrain} onElevationChange={setSegmentElevation} />
          </div>

          <div className="flex flex-col gap-4">
            {connectFrom !== undefined && (
              <p className="border-primary bg-primary/10 text-primary rounded-md border px-3 py-2 text-sm">
                {t("connectHint", { instance: connectFrom.instanceId, port: connectFrom.portId })}
              </p>
            )}
            <PlanCanvas
              instances={derivation.instances}
              connections={derivation.connections}
              selectedId={selectedId}
              connectFrom={connectFrom}
              onSelect={selectInstance}
              onMove={moveInstance}
              onPortClick={handlePortClick}
              onRemoveConnection={removeConnection}
            />
            <SceneViewport scene={derivation.scene} />
            <SiteResultsPanel result={derivation.result} priceBlind={priceBlind} />
          </div>
        </div>
      </main>
    </AuthGuard>
  );
}
