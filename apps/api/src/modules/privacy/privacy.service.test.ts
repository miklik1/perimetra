import { type Queue } from "bullmq";
import { describe, expect, it, vi } from "vitest";

import { PrivacyService } from "./privacy.service.js";
import { PRIVACY_JOBS } from "./privacy.tokens.js";

function makeQueue() {
  const add = vi.fn().mockResolvedValue({ id: "job-1" });
  return { queue: { add } as unknown as Queue, add };
}

describe("PrivacyService", () => {
  it("enqueues an export job with the user id only (IDs-not-PII rule)", async () => {
    const { queue, add } = makeQueue();
    await expect(new PrivacyService(queue).requestExport("u-1")).resolves.toBe("job-1");
    expect(add).toHaveBeenCalledWith(PRIVACY_JOBS.export, { userId: "u-1" });
  });

  it("enqueues an erasure job with the user id only", async () => {
    const { queue, add } = makeQueue();
    await expect(new PrivacyService(queue).requestErasure("u-1")).resolves.toBe("job-1");
    expect(add).toHaveBeenCalledWith(PRIVACY_JOBS.erase, { userId: "u-1" });
  });
});
