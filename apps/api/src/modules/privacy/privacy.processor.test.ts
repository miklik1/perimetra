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
  // `select().from().where()` for the Art. 20 core-user export step. Defaults
  // to no row so the handler-fan-out tests stay focused; a test that exercises
  // the core row overrides `selectWhere` with `[userRow]`.
  const selectWhere = vi.fn().mockResolvedValue([]);
  const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
  const select = vi.fn().mockReturnValue({ from: selectFrom });
  const txHost = { tx: { update, delete: del, select } } as unknown as Ctor[2];
  return {
    txHost,
    update,
    updateSet,
    updateWhere,
    del,
    deleteWhere,
    select,
    selectFrom,
    selectWhere,
  };
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
    // Each entity carries its GDPR data-category alongside the handler's
    // collections; absent `dataCategory` ⇒ "ordinary" (ADR 0040).
    expect(body.data).toEqual({
      project: { projects: [{ id: "p1" }], category: "ordinary" },
      comment: { comments: [], category: "ordinary" },
    });
    expect(presignArgs.contentLength).toBe(Buffer.byteLength(init.body));
  });

  it("tags each entity with its data-category — authoritative over a handler collision", async () => {
    // Mechanical envelope only (ADR 0040): the FACTUAL category label.
    // Escalating a real handler to "special-category" (and the Art. 9(2)
    // basis-condition / basis-filtering it implies) is a per-module legal
    // decision, deliberately NOT exercised here.
    const handlers: PrivacyHandler[] = [
      // Default (no dataCategory) ⇒ "ordinary".
      {
        entityType: "project",
        exportUser: vi.fn().mockResolvedValue({ projects: [] }),
        eraseUser: vi.fn(),
      },
      // Explicit special-category flows through unchanged.
      {
        entityType: "scan",
        dataCategory: "special-category",
        exportUser: vi.fn().mockResolvedValue({ scans: [] }),
        eraseUser: vi.fn(),
      },
      // A handler that returns its OWN `category` key cannot clobber the
      // authoritative tag — it is spread LAST.
      {
        entityType: "note",
        exportUser: vi.fn().mockResolvedValue({ notes: [], category: "special-category" }),
        eraseUser: vi.fn(),
      },
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));

    const { processor } = makeProcessor({ handlers });
    await processor.process(job(PRIVACY_JOBS.export));

    const fetchInit = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1] as {
      body: string;
    };
    const data = (JSON.parse(fetchInit.body) as { data: Record<string, { category: string }> })
      .data;
    expect(data.project!.category).toBe("ordinary");
    expect(data.scan!.category).toBe("special-category");
    // The handler's own "category" collection key is overridden by the tag.
    expect(data.note!.category).toBe("ordinary");
  });

  it("throws (so BullMQ retries) when the S3 upload is rejected", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    const { processor } = makeProcessor({ handlers: [] });
    await expect(processor.process(job(PRIVACY_JOBS.export))).rejects.toThrow(/403/);
  });

  // CONTRACT (ADR 1004, HQ-ruled scope): the export must include the Better Auth
  // core user row — EXACTLY the subject's identity + preference fields — and must
  // never leak the admin() moderation flags or any `account`/`session` secret.
  // This is the regression guard the pii-contract test cannot provide (its
  // `coveredBy("user")` already passes vacuously off the erase-side import).
  it("includes the core user row with exactly the ruled fields, no internal flags", async () => {
    const db = makeDb();
    db.selectWhere.mockResolvedValue([
      {
        id: "u-1",
        name: "Jan Novák",
        email: "jan@example.com",
        emailVerified: true,
        image: "https://cdn/avatar.png",
        locale: "cs",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-02-02T00:00:00.000Z"),
        // admin() moderation flags + secrets that MUST NOT reach the export:
        role: "admin",
        banned: true,
        banReason: "spam",
        banExpires: new Date("2026-03-03T00:00:00.000Z"),
      },
    ]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));

    const { processor } = makeProcessor({ txHost: db.txHost, handlers: [] });
    await processor.process(job(PRIVACY_JOBS.export));

    // Queried against the `user` table, keyed by the subject id — and
    // COLUMN-PROJECTED to exactly the ruled allow-list (ADR 1004 amendment): a
    // later `user` column never enters process memory. Pins the projection in
    // lockstep with the object literal (a same-typed column swap is tsc-invisible,
    // and the exact-key-set assertion below alone cannot catch a widened SELECT).
    expect(db.select).toHaveBeenCalledWith({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      image: user.image,
      locale: user.locale,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });
    expect(db.selectFrom).toHaveBeenCalledWith(user);

    const init = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1] as {
      body: string;
    };
    const exported = (JSON.parse(init.body) as { data: { user: Record<string, unknown> } }).data
      .user;

    // The EXACT emitted key set: the 8 ruled identity/preference fields + the
    // ADR-0040 `category` envelope marker. A new `user` column added later
    // fails this assertion until it is a deliberate export decision.
    expect(Object.keys(exported).sort()).toEqual(
      [
        "category",
        "createdAt",
        "email",
        "emailVerified",
        "id",
        "image",
        "locale",
        "name",
        "updatedAt",
      ].sort(),
    );
    expect(exported).toMatchObject({
      id: "u-1",
      name: "Jan Novák",
      email: "jan@example.com",
      emailVerified: true,
      image: "https://cdn/avatar.png",
      locale: "cs",
      category: "ordinary",
    });
    for (const forbidden of ["role", "banned", "banReason", "banExpires", "password"]) {
      expect(exported).not.toHaveProperty(forbidden);
    }
  });

  it("omits the core user entry when the subject row is absent (deleted/unknown id)", async () => {
    const db = makeDb(); // selectWhere defaults to [] → no row
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    const { processor } = makeProcessor({ txHost: db.txHost, handlers: [] });
    await processor.process(job(PRIVACY_JOBS.export));

    const init = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1] as {
      body: string;
    };
    const data = (JSON.parse(init.body) as { data: Record<string, unknown> }).data;
    expect(data).not.toHaveProperty("user");
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
      purgeUser: vi.fn().mockImplementation(async () => {
        order.push("hook");
        return { status: "documented", detail: "src" };
      }),
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
      diff: { purges: { sentry: { status: "documented", detail: "src" } } },
    });
  });

  it("collects purge outcomes into the audit diff AND returns them (job.returnvalue) — ADR 1010", async () => {
    const hooks: PurgeHook[] = [
      {
        name: "sentry",
        purgeUser: vi.fn().mockResolvedValue({ status: "documented", detail: "d" }),
      },
      { name: "posthog", purgeUser: vi.fn().mockResolvedValue({ status: "purged" }) },
    ];
    const { processor, auditService } = makeProcessor({ purgeHooks: hooks });

    const result = await processor.process(job(PRIVACY_JOBS.erase));

    const expectedPurges = {
      sentry: { status: "documented", detail: "d" },
      posthog: { status: "purged" },
    };
    // Returned so BullMQ stores it as job.returnvalue (the itest-visible read-model).
    expect(result).toEqual(expectedPurges);
    // AND mirrored into the privacy.erase audit diff (no erasure_request table in
    // perimetra, ADR 1010 adaptation — the diff + returnvalue ARE the read-model).
    expect(auditService.record).toHaveBeenCalledWith({
      action: "privacy.erase",
      entityType: "user",
      entityId: "u-1",
      diff: { purges: expectedPurges },
    });
    expect(hooks[0]!.purgeUser).toHaveBeenCalledWith("u-1");
    expect(hooks[1]!.purgeUser).toHaveBeenCalledWith("u-1");
  });

  it("propagates a thrown purge hook (ban-purge escalation → onFailed → DLQ), no audit swallow", async () => {
    const hook: PurgeHook = {
      name: "posthog",
      purgeUser: vi.fn().mockRejectedValue(new Error("posthog person deletion failed: 500")),
    };
    const { processor, auditService } = makeProcessor({ purgeHooks: [hook] });

    await expect(processor.process(job(PRIVACY_JOBS.erase))).rejects.toThrow(/500/);
    // The throw aborts before the audit step — the failure is a thrown job, never
    // a stored outcome (no "failed" PurgeOutcome variant).
    expect(auditService.record).not.toHaveBeenCalled();
  });

  it("runs finalizeErasure in a SECOND pass, after every handler's eraseUser and before core (ADR 1010)", async () => {
    const order: string[] = [];
    const db = makeDb();
    db.update.mockImplementation(() => {
      order.push("core");
      return { set: db.updateSet };
    });
    const mk = (name: string): PrivacyHandler => ({
      entityType: name,
      exportUser: vi.fn(),
      eraseUser: vi.fn().mockImplementation(async () => void order.push(`erase:${name}`)),
      finalizeErasure: vi.fn().mockImplementation(async () => void order.push(`finalize:${name}`)),
    });
    const h1 = mk("h1");
    const h2 = mk("h2");
    const { processor } = makeProcessor({ txHost: db.txHost, handlers: [h1, h2] });

    await processor.process(job(PRIVACY_JOBS.erase));

    // BOTH erase passes complete before ANY finalize; all finalizes before core.
    expect(order).toEqual(["erase:h1", "erase:h2", "finalize:h1", "finalize:h2", "core"]);
    expect(h1.finalizeErasure).toHaveBeenCalledWith("u-1");
    expect(h2.finalizeErasure).toHaveBeenCalledWith("u-1");
  });

  it("tolerates handlers without a finalizeErasure (optional seam)", async () => {
    const handler: PrivacyHandler = {
      entityType: "project",
      exportUser: vi.fn(),
      eraseUser: vi.fn().mockResolvedValue(undefined),
    };
    const { processor } = makeProcessor({ handlers: [handler] });
    await expect(processor.process(job(PRIVACY_JOBS.erase))).resolves.toBeDefined();
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

  it("refuses to boot when a handler claims the reserved 'user' entityType (ADR 1004)", async () => {
    // The Art. 20 core step emits `data.user` AFTER the handler fan-out, so a
    // handler also claiming "user" would be silently clobbered — enforce the
    // reservation structurally: a colliding handler fails BOOT, not at run time.
    const handlers = [
      { entityType: "user", exportUser: vi.fn(), eraseUser: vi.fn() },
    ] as unknown as PrivacyHandler[];
    const { processor } = makeProcessor({ handlers });
    await expect(processor.onApplicationBootstrap()).rejects.toThrow(/reserved/);
  });

  it("logs and ignores unknown job names", async () => {
    const { processor } = makeProcessor({});
    await expect(processor.process(job("mystery"))).resolves.toBeUndefined();
  });
});
