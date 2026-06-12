"use client";

import { useEffect } from "react";

import { invalidateKeys } from "@repo/api";
import { useQueryClient } from "@repo/api/react";
import { useAuth } from "@repo/auth/react";
import { useTranslations } from "@repo/i18n/web";
import { useChannel, useConnectionState } from "@repo/realtime/react";

import { projectKeys } from "../../lib/projects-queries";
import { useRealtime } from "../realtime-provider";

/** What the worker publishes to `user:<ownerId>` (IDs only — never entities). */
interface ProjectRealtimeEvent {
  type: "project.created" | "project.archived";
  projectId: string;
}

/**
 * LIVE badge: connects the shared realtime client (lazy — the socket opens
 * when this mounts, not at app boot) and subscribes to the session user's
 * channel via `useChannel`. The worker's outbox consumers publish
 * `project.created` / `project.archived` with `{ projectId }`; payloads carry
 * IDs only, so reacting = invalidating the projects list and letting TanStack
 * refetch the truth — no cache surgery from a push payload.
 */
export function ProjectsLiveBadge() {
  const t = useTranslations("projects");
  const client = useRealtime();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // connect() is idempotent on the adapter; the provider owns disconnect.
  useEffect(() => {
    client.connect();
  }, [client]);

  const state = useConnectionState(client);

  useChannel<ProjectRealtimeEvent>(client, user ? `user:${user.id}` : null, {
    onPublication: ({ data }) => {
      if (data.type === "project.created" || data.type === "project.archived") {
        void invalidateKeys(queryClient, [projectKeys.lists()]);
      }
    },
  });

  const label =
    state === "connected" ? t("live") : state === "connecting" ? t("connecting") : t("offline");
  const dotClass =
    state === "connected"
      ? "bg-green-500"
      : state === "connecting"
        ? "bg-yellow-500"
        : "bg-muted-foreground";

  return (
    <span
      className="border-border text-muted-foreground inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs"
      role="status"
    >
      <span aria-hidden className={`size-2 rounded-full ${dotClass}`} />
      {label}
    </span>
  );
}
