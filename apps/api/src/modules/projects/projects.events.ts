/**
 * Worker-side consumer of the project outbox events (spec §7.8 chain:
 * outbox → relay → events queue → here → Centrifugo). Payloads are IDs only
 * (ADR 0037), so the handler RE-FETCHES the project — both for fresh state
 * and for the `ownerId` that names the channel.
 *
 * Delivery is at-least-once: every branch here is an idempotent no-op when
 * re-run (publish is fire-and-forget state-free; missing rows are skipped).
 */
import { Injectable, Logger, Optional } from "@nestjs/common";

import { AnalyticsService } from "../analytics/analytics.service.js";
import { type DomainEventHandler } from "../jobs/jobs.tokens.js";
import { RealtimeService } from "../realtime/realtime.service.js";
import { userChannel } from "../realtime/realtime.tokens.js";
import { ProjectsRepository } from "./projects.repository.js";
import { PROJECT_ARCHIVED, PROJECT_CREATED } from "./projects.tokens.js";

@Injectable()
export class ProjectsEventsHandler implements DomainEventHandler {
  private readonly logger = new Logger(ProjectsEventsHandler.name);

  readonly eventTypes = [PROJECT_CREATED, PROJECT_ARCHIVED] as const;

  constructor(
    private readonly projects: ProjectsRepository,
    private readonly realtime: RealtimeService,
    @Optional() private readonly analytics?: AnalyticsService,
  ) {}

  async handle(event: {
    eventType: string;
    aggregateType: string;
    aggregateId: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    const projectId = event.payload["projectId"];
    if (typeof projectId !== "string") {
      // Poison payload — retrying can never fix it; log loudly and drop.
      this.logger.error(`event ${event.eventType} carried no string projectId — skipping`);
      return;
    }

    const project = await this.projects.findByIdSystem(projectId);
    if (!project) {
      // Deleted before the worker caught up — nothing to notify about.
      this.logger.warn(`project ${projectId} gone before ${event.eventType} was handled`);
      return;
    }

    // Fail-soft by design (RealtimeService logs failures): a Centrifugo
    // outage must not dead-letter domain events over a lost notification.
    await this.realtime.publish(userChannel(project.ownerId), {
      type: event.eventType,
      projectId: project.id,
    });

    // Server-side capture (ADR 0036): domain events are facts the client
    // can't be trusted to report. distinctId = owner (ADR 0028 bridge);
    // IDs only, never PII. No-op without a PostHog key.
    this.analytics?.capture(project.ownerId, event.eventType.replace(".", "_"), {
      projectId: project.id,
    });
  }
}
