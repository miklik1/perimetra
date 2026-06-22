"use client";

import * as React from "react";

import { useApiClient, useMutation } from "@repo/api/react";

import { createPlatformQueries } from "../../../../lib/platform-queries";
import { type ReleaseDraftInput, type ReleaseEditorForm } from "./section-schemas";

/**
 * Autosave (ADR 0068 Phase 3B) — persists the editor's form state to the
 * MUTABLE `release_draft` store continuously, so closing the tab never loses
 * work. Mirrors `useReleaseValidation`'s debounced `form.watch` subscription.
 *
 * - A FRESH editor holds no draft until the first edit; the first autosave
 *   CREATEs the row, then `onCreated` lets the caller swap the URL to
 *   `/platform/releases/drafts/[id]` (history-only, no remount) so a reload
 *   resumes. Subsequent saves PATCH.
 * - Saves are SERIALIZED (one in flight) and coalesced (a change during a save
 *   queues exactly one follow-up) so autosave never races itself.
 * - `body` is the whole form value (the web `ReleaseDraftInput`); `modelId` /
 *   `version` / `catalogVersion` / `baseReleaseId` are denorm projections off it
 *   for the draft list. Publish stays the immutable `POST /v1/releases`.
 */
export type SaveStatus = "idle" | "unsaved" | "saving" | "saved" | "error";

export interface UseDraftAutosaveOptions {
  /** Existing draft id when resuming; undefined for a fresh editor. */
  initialDraftId?: string;
  /** Provenance for clone-and-bump (Phase 3C); persisted on every save. */
  baseReleaseId?: string | null;
  /** Called once with the new id when a fresh draft is first persisted. */
  onCreated?: (id: string) => void;
  /** Debounce before autosaving (ms). */
  debounceMs?: number;
}

export interface DraftAutosave {
  status: SaveStatus;
  /** The persisted draft id (null until the first save of a fresh editor). */
  draftId: string | null;
}

/** Form values → the create/update payload (denorm projections + opaque body). */
function payloadFrom(values: ReleaseDraftInput, baseReleaseId: string | null) {
  const v = Number(values.catalogVersion);
  return {
    modelId: `${values.modelId ?? ""}`,
    version: Number(values.version) || 1,
    // 0 / blank / NaN means "no catalog picked yet".
    catalogVersion: Number.isFinite(v) && v > 0 ? v : null,
    baseReleaseId,
    body: values,
  };
}

export function useDraftAutosave(
  form: ReleaseEditorForm,
  opts: UseDraftAutosaveOptions = {},
): DraftAutosave {
  const { initialDraftId, baseReleaseId = null, onCreated, debounceMs = 1500 } = opts;
  const client = useApiClient();
  const queries = React.useMemo(() => createPlatformQueries(client), [client]);
  const createMut = useMutation(queries.createDraft());
  const updateMut = useMutation(queries.updateDraft());

  const draftIdRef = React.useRef<string | null>(initialDraftId ?? null);
  const [draftId, setDraftId] = React.useState<string | null>(initialDraftId ?? null);
  const [status, setStatus] = React.useState<SaveStatus>(initialDraftId ? "saved" : "idle");

  // Save serialization: one request in flight; a change meanwhile queues one.
  const savingRef = React.useRef(false);
  const pendingRef = React.useRef(false);

  // Latest mutations + callbacks reachable inside the stable `save` without
  // re-creating it (which would re-subscribe the watch every render).
  const latest = React.useRef({ createMut, updateMut, baseReleaseId, onCreated, form });
  latest.current = { createMut, updateMut, baseReleaseId, onCreated, form };

  const save = React.useCallback(async () => {
    if (savingRef.current) {
      pendingRef.current = true;
      return;
    }
    savingRef.current = true;
    setStatus("saving");
    const { createMut, updateMut, baseReleaseId, onCreated, form } = latest.current;
    try {
      const payload = payloadFrom(form.getValues() as ReleaseDraftInput, baseReleaseId);
      if (draftIdRef.current == null) {
        const created = await createMut.mutateAsync(payload);
        draftIdRef.current = created.id;
        setDraftId(created.id);
        onCreated?.(created.id);
      } else {
        await updateMut.mutateAsync({ id: draftIdRef.current, ...payload });
      }
      setStatus(pendingRef.current ? "unsaved" : "saved");
    } catch {
      setStatus("error");
    } finally {
      savingRef.current = false;
      if (pendingRef.current) {
        pendingRef.current = false;
        void save();
      }
    }
  }, []);

  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const subscription = form.watch(() => {
      setStatus((s) => (s === "saving" ? s : "unsaved"));
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void save(), debounceMs);
    });
    return () => {
      if (timer) clearTimeout(timer);
      subscription.unsubscribe();
    };
  }, [form, save, debounceMs]);

  return { status, draftId };
}
