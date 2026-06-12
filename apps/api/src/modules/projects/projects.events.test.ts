import { describe, expect, it, vi } from "vitest";

import { ProjectsEventsHandler } from "./projects.events.js";

const PROJECT_ID = "01890a5d-ac96-774b-bcce-b302099a0001";

function makeHandler(project: { id: string; ownerId: string } | null) {
  const projects = { findByIdSystem: vi.fn().mockResolvedValue(project) };
  const realtime = { publish: vi.fn().mockResolvedValue(true) };
  const handler = new ProjectsEventsHandler(projects as never, realtime as never);
  return { handler, projects, realtime };
}

const event = (payload: Record<string, unknown>) => ({
  eventType: "project.created",
  aggregateType: "project",
  aggregateId: PROJECT_ID,
  payload,
});

describe("ProjectsEventsHandler", () => {
  it("declares the project event types for the multi-provider dispatch", () => {
    const { handler } = makeHandler(null);
    expect(handler.eventTypes).toEqual(["project.created", "project.archived"]);
  });

  it("re-fetches the project (IDs-only payload) and publishes to the owner channel", async () => {
    const { handler, projects, realtime } = makeHandler({ id: PROJECT_ID, ownerId: "user-1" });

    await handler.handle(event({ projectId: PROJECT_ID }));

    expect(projects.findByIdSystem).toHaveBeenCalledWith(PROJECT_ID);
    expect(realtime.publish).toHaveBeenCalledWith("user:user-1", {
      type: "project.created",
      projectId: PROJECT_ID,
    });
  });

  it("skips quietly when the project is already gone (at-least-once delivery)", async () => {
    const { handler, realtime } = makeHandler(null);
    await handler.handle(event({ projectId: PROJECT_ID }));
    expect(realtime.publish).not.toHaveBeenCalled();
  });

  it("drops a poison payload without a string projectId instead of retrying forever", async () => {
    const { handler, projects, realtime } = makeHandler(null);
    await handler.handle(event({ projectId: 42 }));
    expect(projects.findByIdSystem).not.toHaveBeenCalled();
    expect(realtime.publish).not.toHaveBeenCalled();
  });
});
