/**
 * Housekeeping jobs (worker deployable) — driven by BullMQ job schedulers
 * (the repeatables-only cron rule, ADR 0043). Registered on bootstrap, so a
 * fresh environment self-schedules.
 */
import { InjectQueue, Processor, WorkerHost } from "@nestjs/bullmq";
import { Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { Queue, type Job } from "bullmq";

import { upsertScheduler } from "../jobs/jobs.module.js";
import { QUEUES } from "../jobs/jobs.tokens.js";
import { OutboxRelayService } from "./outbox-relay.service.js";

const JOB_OUTBOX_CLEANUP = "outbox-cleanup";

@Processor(QUEUES.maintenance)
export class MaintenanceProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(MaintenanceProcessor.name);

  constructor(
    @InjectQueue(QUEUES.maintenance) private readonly maintenance: Queue,
    private readonly relay: OutboxRelayService,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    await upsertScheduler(
      this.maintenance,
      JOB_OUTBOX_CLEANUP,
      { pattern: "0 3 * * *", tz: "Europe/Prague" },
      { name: JOB_OUTBOX_CLEANUP },
    );
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case JOB_OUTBOX_CLEANUP:
        await this.relay.cleanup();
        return;
      default:
        this.logger.warn(`unknown maintenance job "${job.name}"`);
    }
  }
}
