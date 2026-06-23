import { type Job, type Queue } from "bullmq";
import { uuidv7 } from "uuidv7";
import { afterEach, describe, expect, it, vi } from "vitest";

import { audit } from "@repo/db/schema/audit";
import { account, session, twoFactor, user } from "@repo/db/schema/auth";

import { type AuditService } from "../audit/audit.service.js";
import { type StorageService } from "../storage/storage.service.js";
import { PrivacyProcessor, uuidv7Boundary } from "./privacy.processor.js";
import { PRIVACY_JOBS, type PrivacyHandler, type PurgeHook } from "./privacy.tokens.js";

type Ctor = ConstructorParameters<typeof PrivacyProcessor>;

function makeDb() {
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const update = vi.fn().mockReturnValue({ set: updateSet });
  const deleteWhere = vi.fn().mockResolvedValue(undefined);
  const del = vi.fn().mockReturnValue({ where: deleteWhere });
  const txHost = { tx: { update, delete: del } } as unknown as Ctor[2];
  return { txHost, update, updateSet, updateWhere, del, deleteWhere };
}

function makeProcessor(overrides: {
  txHost?: Ctor[2];
  storage?: Partial<StorageService>;
  auditService?: Partial<AuditService>;
  handlers?: PrivacyHandler[];
  purgeHooks?: PurgeHook[];
}) {
  const storage = {
    presignUpload: vi
      .fn()
      .mockResolvedValue({ url: "http://s3/put", key: "k", expiresInSeconds: 300 }),
    ...overrides.storage,
  };
  const auditService = { record: vi.fn().mockResolvedValue(undefined), ...overrides.auditService };
  const upsertJobScheduler = vi.fn();
  const processor = new PrivacyProcessor(
    { upsertJobScheduler } as unknown as Queue,
    { add: vi.fn() } as unknown as Queue,
    overrides.txHost ?? makeDb().txHost,
    storage as unknown as StorageService,
    auditService as unknown as AuditService,
    overrides.handlers ?? [],
    overrides.purgeHooks ?? [],
  );
  return { processor, storage, auditService, upsertJobScheduler };
}

const job = (name: string, data: Record<string, unknown> = { userId: "u-1" }) =>
  ({ name, data }) as unknown as Job;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("PrivacyProcessor export (Art. 20)", () => {
  it("merges every handler's export into one JSON and PUTs it to S3", async () => {
    const handlers: PrivacyHandler[] = [
      {
        entityType: "project",
        exportUser: vi.fn().mockResolvedValue({ projects: [{ id: "p1" }] }),
        eraseUser: vi.fn(),
      },
      {
        entityType: "comment",
        exportUser: vi.fn().mockResolvedValue({ comments: [] }),
        eraseUser: vi.fn(),
      },
    ];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const { processor, storage } = makeProcessor({ handlers });
    await processor.process(job(PRIVACY_JOBS.export));

    expect(handlers[0]!.exportUser).toHaveBeenCalledWith("u-1");
    expect(handlers[1]!.exportUser).toHaveBeenCalledWith("u-1");

    const presignArgs = (storage.presignUpload as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      key: string;
      contentType: string;
      contentLength: number;
    };
    expect(presignArgs.key).toMatch(/^privacy-exports\/u-1\/[0-9a-f-]+\.json$/);
    expect(presignArgs.contentType).toBe("application/json");

    const [url, init] = fetchMock.mock.calls[0]! as [string, { method: string; body: string }];
    expect(url).toBe("http://s3/put");
    expect(init.method).toBe("PUT");
    const body = JSON.parse(init.body) as { userId: string; data: Record<string, unknown> };
    expect(body.userId).toBe("u-1");
    expect(body.data).toEqual({
      project: { projects: [{ id: "p1" }] },
      comment: { comments: [] },
    });
    expect(presignArgs.contentLength).toBe(Buffer.byteLength(init.body));
  });

  it("throws (so BullMQ retries) when the S3 upload is rejected", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    const { processor } = makeProcessor({ handlers: [] });
    await expect(processor.process(job(PRIVACY_JOBS.export))).rejects.toThrow(/403/);
  });
});

describe("PrivacyProcessor erasure (Art. 17)", () => {
  it("runs handlers first, then core erasures, then purge hooks, then audit", async () => {
    const order: string[] = [];
    const db = makeDb();
    db.update.mockImplementation(() => {
      order.push("core");
      return { set: db.updateSet };
    });
    const handler = (name: string): PrivacyHandler => ({
      entityType: name,
      exportUser: vi.fn(),
      eraseUser: vi.fn().mockImplementation(async () => void order.push(name)),
    });
    const hook: PurgeHook = {
      name: "sentry",
      purgeUser: vi.fn().mockImplementation(async () => void order.push("hook")),
    };
    const { processor, auditService } = makeProcessor({
      txHost: db.txHost,
      handlers: [handler("h1"), handler("h2")],
      purgeHooks: [hook],
    });
    (auditService.record as ReturnType<typeof vi.fn>).mockImplementation(
      async () => void order.push("audit"),
    );

    await processor.process(job(PRIVACY_JOBS.erase));

    expect(order).toEqual(["h1", "h2", "core", "hook", "audit"]);
    expect(auditService.record).toHaveBeenCalledWith({
      action: "privacy.erase",
      entityType: "user",
      entityId: "u-1",
    });
  });

  it("anonymizes the user row and deletes sessions + accounts + two-factor (SQL shape)", async () => {
    const db = makeDb();
    const { processor } = makeProcessor({ txHost: db.txHost });

    await processor.process(job(PRIVACY_JOBS.erase));

    expect(db.update).toHaveBeenCalledExactlyOnceWith(user);
    // Clears twoFactorEnabled too — the kept (anonymized) row must not claim MFA.
    expect(db.updateSet).toHaveBeenCalledExactlyOnceWith({
      name: "erased-u-1@erased.invalid",
      email: "erased-u-1@erased.invalid",
      image: null,
      twoFactorEnabled: false,
    });
    expect(db.updateWhere).toHaveBeenCalledOnce();
    // Credential purge keyed on the user id: sessions, then accounts (password
    // hash), then two-factor (TOTP secret + backup codes) — the cascade can't
    // fire on the anonymized user row, so each is an explicit delete.
    expect(db.del.mock.calls.map((c) => c[0])).toEqual([session, account, twoFactor]);
    expect(db.deleteWhere).toHaveBeenCalledTimes(3);
  });
});

describe("audit retention sweep", () => {
  it("uuidv7Boundary encodes the cutoff as the smallest uuid of that instant", () => {
    expect(uuidv7Boundary(new Date(0))).toBe("00000000-0000-7000-8000-000000000000");
    expect(uuidv7Boundary(new Date(Date.UTC(2024, 0, 1)))).toBe(
      "018cc251-f400-7000-8000-000000000000",
    );
    // Any uuid generated NOW sorts after the boundary of one ms ago,
    // and before the boundary of one second ahead (bytewise = lexicographic).
    const now = Date.now();
    const generated = uuidv7();
    expect(generated > uuidv7Boundary(new Date(now - 1))).toBe(true);
    expect(generated < uuidv7Boundary(new Date(now + 1_000))).toBe(true);
  });

  it("deletes audit rows older than the 2-year retention via the PK boundary", async () => {
    const db = makeDb();
    const { processor } = makeProcessor({ txHost: db.txHost });

    await processor.process(job(PRIVACY_JOBS.auditCleanup, {}));

    expect(db.del).toHaveBeenCalledExactlyOnceWith(audit);
    expect(db.deleteWhere).toHaveBeenCalledOnce();
  });
});

describe("scheduling + unknown jobs", () => {
  it("self-schedules the daily audit-cleanup on the privacy queue", async () => {
    const { processor, upsertJobScheduler } = makeProcessor({});

    await processor.onApplicationBootstrap();

    expect(upsertJobScheduler).toHaveBeenCalledWith(
      "audit-cleanup",
      { pattern: "30 3 * * *", tz: "Europe/Prague" },
      { name: PRIVACY_JOBS.auditCleanup },
    );
  });

  it("logs and ignores unknown job names", async () => {
    const { processor } = makeProcessor({});
    await expect(processor.process(job("mystery"))).resolves.toBeUndefined();
  });
});
