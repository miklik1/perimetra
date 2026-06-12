import { type TransactionHost } from "@nestjs-cls/transactional";
import { describe, expect, it, vi } from "vitest";

import { OutboxService } from "./outbox.service.js";

type AnyTxHost = ConstructorParameters<typeof OutboxService>[0];

function makeTxHost(active: boolean, insertedId = "0197-test") {
  const returning = vi.fn().mockResolvedValue([{ id: insertedId }]);
  const values = vi.fn().mockReturnValue({ returning });
  const insert = vi.fn().mockReturnValue({ values });
  return {
    host: {
      isTransactionActive: () => active,
      tx: { insert },
    } as unknown as AnyTxHost,
    insert,
    values,
  };
}

const EVENT = {
  aggregateType: "project",
  aggregateId: "p-1",
  eventType: "project.created",
  payload: { projectId: "p-1" },
};

describe("OutboxService.emit", () => {
  it("refuses to emit outside an active transaction (ADR 0037)", async () => {
    const { host } = makeTxHost(false);
    await expect(new OutboxService(host).emit(EVENT)).rejects.toThrow(/@Transactional/);
  });

  it("writes through the ambient transactional client and returns the id", async () => {
    const { host, insert, values } = makeTxHost(true, "0197-abc");
    await expect(new OutboxService(host).emit(EVENT)).resolves.toBe("0197-abc");
    expect(insert).toHaveBeenCalledOnce();
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ eventType: "project.created" }));
  });
});

// Type-level guard: the service must accept the real TransactionHost shape.
void (undefined as unknown as TransactionHost);
