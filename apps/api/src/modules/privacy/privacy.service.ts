/**
 * API-side privacy surface: enqueue export/erasure jobs (IDs only — the
 * worker re-fetches everything, spec §7.2 rule). The actual fan-out runs in
 * `PrivacyProcessor` (worker deployable).
 */
import { InjectQueue } from "@nestjs/bullmq";
import { Injectable } from "@nestjs/common";
import { Queue } from "bullmq";

import { QUEUES } from "../jobs/jobs.tokens.js";
import { PRIVACY_JOBS } from "./privacy.tokens.js";

interface PrivacyJobData extends Record<string, unknown> {
  userId: string;
}

@Injectable()
export class PrivacyService {
  constructor(@InjectQueue(QUEUES.privacy) private readonly queue: Queue) {}

  /** GDPR Art. 20 — queue a full data export. Returns the BullMQ job id. */
  async requestExport(userId: string): Promise<string | undefined> {
    const job = await this.queue.add(PRIVACY_JOBS.export, { userId } satisfies PrivacyJobData);
    return job.id;
  }

  /** GDPR Art. 17 — queue erasure across all handlers + core tables. */
  async requestErasure(userId: string): Promise<string | undefined> {
    const job = await this.queue.add(PRIVACY_JOBS.erase, { userId } satisfies PrivacyJobData);
    return job.id;
  }
}
