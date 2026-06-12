import { Logger } from "@nestjs/common";
import { CLS_REQ, type ClsService } from "nestjs-cls";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuditService } from "./audit.service.js";

type AnyTxHost = ConstructorParameters<typeof AuditService>[0];

function makeTxHost(insert = vi.fn()) {
  const values = vi.fn().mockResolvedValue(undefined);
  insert.mockReturnValue({ values });
  return { host: { tx: { insert } } as unknown as AnyTxHost, insert, values };
}

function makeCls(active: boolean, requestId?: string): ClsService {
  return {
    isActive: () => active,
    get: (key: unknown) => (key === CLS_REQ ? { id: requestId } : undefined),
  } as unknown as ClsService;
}

const ENTRY = {
  actorId: "user-1",
  action: "project.create",
  entityType: "project",
  entityId: "p-1",
  diff: { after: { name: "n" } },
};

afterEach(() => vi.restoreAllMocks());

describe("AuditService.record", () => {
  it("writes through the ambient transactional client", async () => {
    const { host, insert, values } = makeTxHost();
    await new AuditService(host).record(ENTRY);

    expect(insert).toHaveBeenCalledOnce();
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "user-1",
        action: "project.create",
        entityType: "project",
        entityId: "p-1",
        diff: { after: { name: "n" } },
      }),
    );
  });

  it("fails soft: a rejected insert logs but never throws", async () => {
    const errorLog = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const { host, values } = makeTxHost();
    values.mockRejectedValueOnce(new Error("connection refused"));

    await expect(new AuditService(host).record(ENTRY)).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalledOnce();
  });

  it("fails soft when the client itself blows up synchronously", async () => {
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const host = {
      get tx(): never {
        throw new Error("no CLS context");
      },
    } as unknown as AnyTxHost;

    await expect(new AuditService(host).record(ENTRY)).resolves.toBeUndefined();
  });

  it("pulls the pino request id from the CLS-saved request", async () => {
    const { host, values } = makeTxHost();
    await new AuditService(host, makeCls(true, "req-42")).record(ENTRY);

    expect(values).toHaveBeenCalledWith(expect.objectContaining({ requestId: "req-42" }));
  });

  it("prefers an explicit requestId over CLS and tolerates missing CLS", async () => {
    const { host, values } = makeTxHost();
    await new AuditService(host, makeCls(true, "req-42")).record({
      ...ENTRY,
      requestId: "job-7",
    });
    expect(values).toHaveBeenLastCalledWith(expect.objectContaining({ requestId: "job-7" }));

    await new AuditService(host).record(ENTRY); // no ClsService at all (worker)
    expect(values).toHaveBeenLastCalledWith(expect.objectContaining({ requestId: null }));
  });

  it("defaults actorId to null for system actions", async () => {
    const { host, values } = makeTxHost();
    await new AuditService(host, makeCls(false)).record({
      action: "privacy.erase",
      entityType: "user",
      entityId: "u-1",
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: null, requestId: null }),
    );
  });
});
