/**
 * Scheduler unit tests. Pairs with integration.test.ts at the package root
 * for end-to-end corpus replay.
 *
 * The pool is faked here as a tiny event emitter — tests push events into
 * it and assert the cache state and stats. The fetcher is mocked per-test.
 */
import type { Event as NostrEvent } from "nostr-tools/core";
import type { Filter } from "nostr-tools/filter";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BitcoinmintsDB } from "../cache";
import type { MintInfoFetcher, MintInfoResult } from "../cashu/info";
import type { Pool, PoolHandle, SubscribeOptions } from "../nostr";
import { createScheduler } from "./index";

// ─── fake pool ──────────────────────────────────────────────────────────
type FakeSub = { opts: SubscribeOptions; handle: PoolHandle; closed: boolean };

function makeFakePool(): {
  pool: Pool;
  subs: FakeSub[];
  pushEvent: (event: NostrEvent) => Promise<void>;
} {
  const subs: FakeSub[] = [];
  const pool: Pool = {
    subscribe(opts: SubscribeOptions): PoolHandle {
      const sub: FakeSub = {
        opts,
        closed: false,
        handle: {
          close() {
            sub.closed = true;
          },
        },
      };
      subs.push(sub);
      return sub.handle;
    },
    close() {
      for (const s of subs) s.closed = true;
    },
  };
  return {
    pool,
    subs,
    async pushEvent(event: NostrEvent) {
      // Fan-out to every subscription whose filters match the event kind.
      for (const sub of subs) {
        if (sub.closed) continue;
        const matches = sub.opts.filters.some((f: Filter) => f.kinds?.includes(event.kind));
        if (matches) {
          sub.opts.onEvent(event, "wss://test.relay");
          // Yield so the async handler can complete its DB writes before the
          // next event is pushed in.
          await new Promise<void>((r) => setTimeout(r, 0));
        }
      }
    },
  };
}

// ─── helpers ────────────────────────────────────────────────────────────
const freshName = () => `test-scheduler-${Math.random().toString(36).slice(2)}`;
const toDispose: BitcoinmintsDB[] = [];

afterEach(async () => {
  while (toDispose.length > 0) {
    const db = toDispose.pop();
    if (!db) continue;
    db.close();
    await BitcoinmintsDB.delete(db.name);
  }
});

async function freshDB(): Promise<BitcoinmintsDB> {
  const db = new BitcoinmintsDB(freshName());
  toDispose.push(db);
  await db.open();
  return db;
}

/** Spec-conforming kind:38172 with a synthetic 66-char d-tag. */
function makeAnnouncement(opts: {
  pubkey: string;
  d: string;
  u: string[];
  createdAt?: number;
  eventId?: string;
}): NostrEvent {
  return {
    id: opts.eventId ?? `event-${opts.d.slice(0, 8)}`,
    kind: 38172,
    pubkey: opts.pubkey,
    created_at: opts.createdAt ?? 1_700_000_000,
    tags: [["d", opts.d], ...opts.u.map((u) => ["u", u])],
    content: "",
    sig: "fake",
  };
}

/** Simple mocked fetcher: map[url] -> pubkey or "fail". */
function makeFetcher(responses: Record<string, string | "fail">): {
  fetcher: MintInfoFetcher;
  calls: string[];
} {
  const calls: string[] = [];
  const fetcher: MintInfoFetcher = async (url: string): Promise<MintInfoResult> => {
    calls.push(url);
    const r = responses[url];
    if (r === undefined) return { ok: false, error: "non-2xx (404)", status: 404 };
    if (r === "fail") return { ok: false, error: "connect ETIMEDOUT" };
    return { ok: true, info: { pubkey: r, name: "test mint" } };
  };
  return { fetcher, calls };
}

/** Wait for inflight Layer B work to drain. */
async function settle(): Promise<void> {
  // Two macrotask flushes is enough to clear the runLayerB chain (await
  // verifySignerBinding -> await db.put -> await upsertMintInfo).
  for (let i = 0; i < 10; i++) await new Promise<void>((r) => setTimeout(r, 0));
}

// ─── tests ───────────────────────────────────────────────────────────────

describe("scheduler — pipeline (single event)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("accepts a Cashu announcement and updates verifiedBySignerBinding=true on pubkey match", async () => {
    const db = await freshDB();
    const { pool, pushEvent } = makeFakePool();
    const pubkey = "02".padEnd(66, "a");
    const { fetcher } = makeFetcher({ "https://mint.example.com": pubkey });
    const sched = createScheduler({ db, pool, fetcher, relays: ["wss://test"] });
    await sched.start();

    await pushEvent(makeAnnouncement({ pubkey, d: pubkey, u: ["https://mint.example.com"] }));
    await settle();
    await sched.stop();

    const row = await db.announcements.get([pubkey, 38172, pubkey]);
    expect(row).toBeDefined();
    expect(row?.verifiedBySignerBinding).toBe(true);

    const stats = sched.getStats();
    expect(stats.eventsReceived).toBe(1);
    expect(stats.accepted).toBe(1);
    expect(stats.layerBVerified).toBe(1);
    expect(stats.layerBFailed).toBe(0);
    expect(stats.layerBPending).toBe(0);

    const mintInfo = await db.mintInfo.get(pubkey);
    expect(mintInfo?.ok).toBe(true);
    expect(mintInfo?.url).toBe("https://mint.example.com");
  });

  it("sets verifiedBySignerBinding=false on pubkey mismatch + writes !ok mintInfo", async () => {
    const db = await freshDB();
    const { pool, pushEvent } = makeFakePool();
    const pubkey = "02".padEnd(66, "b");
    const { fetcher } = makeFetcher({
      "https://mint.example.com": "02".padEnd(66, "z"),
    });
    const sched = createScheduler({ db, pool, fetcher, relays: ["wss://test"] });
    await sched.start();

    await pushEvent(makeAnnouncement({ pubkey, d: pubkey, u: ["https://mint.example.com"] }));
    await settle();
    await sched.stop();

    const row = await db.announcements.get([pubkey, 38172, pubkey]);
    expect(row?.verifiedBySignerBinding).toBe(false);

    const stats = sched.getStats();
    expect(stats.layerBVerified).toBe(0);
    expect(stats.layerBFailed).toBe(1);

    const mintInfo = await db.mintInfo.get(pubkey);
    expect(mintInfo?.ok).toBe(false);
    expect(mintInfo?.lastError).toContain("pubkey-mismatch");
  });

  it("rejects bot-spam d-tag at Layer A (rejectedByLayerA stat increments)", async () => {
    const db = await freshDB();
    const { pool, pushEvent } = makeFakePool();
    const { fetcher, calls } = makeFetcher({});
    const sched = createScheduler({ db, pool, fetcher, relays: ["wss://test"] });
    await sched.start();

    await pushEvent({
      id: "spam-1",
      kind: 38172,
      pubkey: "972f233a".padEnd(64, "0"),
      created_at: 1_700_000_000,
      tags: [
        ["d", "shortspamtag123"], // 15-char garbage — fails Layer A
        ["u", "https://mint.example.com"],
      ],
      content: "",
      sig: "fake",
    });
    await settle();
    await sched.stop();

    expect(await db.announcements.count()).toBe(0);
    expect(sched.getStats().rejectedByLayerA).toBe(1);
    expect(sched.getStats().layerBVerified).toBe(0);
    // Layer B never ran (event was rejected before enqueue).
    expect(calls.length).toBe(0);
  });

  it("Fedimint (kind:38173) is accepted but Layer B is not enqueued", async () => {
    const db = await freshDB();
    const { pool, pushEvent } = makeFakePool();
    const { fetcher, calls } = makeFetcher({});
    const sched = createScheduler({ db, pool, fetcher, relays: ["wss://test"] });
    await sched.start();

    const fedPubkey = "fedopk".padEnd(64, "0");
    await pushEvent({
      id: "fed-1",
      kind: 38173,
      pubkey: fedPubkey,
      created_at: 1_700_000_000,
      tags: [
        ["d", "fed11abc"],
        ["u", "fed11abc..."],
      ],
      content: "",
      sig: "fake",
    });
    await settle();
    await sched.stop();

    expect(await db.announcements.count()).toBe(1);
    expect(sched.getStats().accepted).toBe(1);
    expect(sched.getStats().layerBVerified).toBe(0);
    expect(sched.getStats().layerBFailed).toBe(0);
    expect(calls.length).toBe(0);
  });

  it("kind:38000 review flows into reviews table", async () => {
    const db = await freshDB();
    const { pool, pushEvent } = makeFakePool();
    const { fetcher } = makeFetcher({});
    const sched = createScheduler({ db, pool, fetcher, relays: ["wss://test"] });
    await sched.start();

    await pushEvent({
      id: "review-1",
      kind: 38000,
      pubkey: "reviewer1".padEnd(64, "0"),
      created_at: 1_700_000_000,
      tags: [
        ["k", "38172"],
        ["d", "02".padEnd(66, "a")],
        ["rating", "5", "5"],
      ],
      content: "[5/5] solid",
      sig: "fake",
    });
    await settle();
    await sched.stop();

    expect(await db.reviews.count()).toBe(1);
    expect(sched.getStats().accepted).toBe(1);
  });

  it("kind:0 profile flows into profiles table; kind:10002 into relayLists", async () => {
    const db = await freshDB();
    const { pool, pushEvent } = makeFakePool();
    const { fetcher } = makeFetcher({});
    const sched = createScheduler({ db, pool, fetcher, relays: ["wss://test"] });
    await sched.start();

    await pushEvent({
      id: "profile-1",
      kind: 0,
      pubkey: "profile1".padEnd(64, "0"),
      created_at: 1_700_000_000,
      tags: [],
      content: JSON.stringify({ name: "alice", picture: "https://example.com/a.png" }),
      sig: "fake",
    });
    await pushEvent({
      id: "relays-1",
      kind: 10002,
      pubkey: "profile2".padEnd(64, "0"),
      created_at: 1_700_000_001,
      tags: [
        ["r", "wss://relay1.test"],
        ["r", "wss://relay2.test", "read"],
      ],
      content: "",
      sig: "fake",
    });
    await settle();
    await sched.stop();

    const profile = await db.profiles.get("profile1".padEnd(64, "0"));
    expect(profile?.name).toBe("alice");
    expect(profile?.picture).toBe("https://example.com/a.png");

    const relayList = await db.relayLists.get("profile2".padEnd(64, "0"));
    expect(relayList?.relays).toHaveLength(2);
    expect(relayList?.relays[0]).toEqual({
      url: "wss://relay1.test",
      read: true,
      write: true,
    });
    expect(relayList?.relays[1]).toEqual({
      url: "wss://relay2.test",
      read: true,
      write: false,
    });
  });

  it("getStats returns a defensive copy (caller mutation does not leak)", async () => {
    const db = await freshDB();
    const { pool } = makeFakePool();
    const { fetcher } = makeFetcher({});
    const sched = createScheduler({ db, pool, fetcher, relays: ["wss://test"] });
    await sched.start();

    const snap = sched.getStats();
    snap.eventsReceived = 9999;
    expect(sched.getStats().eventsReceived).toBe(0);
    await sched.stop();
  });

  it("stop() is idempotent and start() is idempotent", async () => {
    const db = await freshDB();
    const { pool, subs } = makeFakePool();
    const { fetcher } = makeFetcher({});
    const sched = createScheduler({ db, pool, fetcher, relays: ["wss://test"] });

    const p1 = sched.start();
    const p2 = sched.start(); // second start — should be a no-op
    await Promise.all([p1, p2]);
    expect(subs.length).toBe(1); // only one subscribe call

    await sched.stop();
    await sched.stop(); // second stop — should not throw
    expect(subs[0]?.closed).toBe(true);
  });
});

describe("scheduler — restart + watermark restore", () => {
  it("on second start, applies a `since` filter derived from cache max(createdAt) per kind", async () => {
    const db = await freshDB();
    const { pool: pool1, pushEvent: push1 } = makeFakePool();
    const pubkey = "02".padEnd(66, "c");
    const { fetcher } = makeFetcher({ "https://mint.example.com": pubkey });

    const sched1 = createScheduler({ db, pool: pool1, fetcher, relays: ["wss://test"] });
    await sched1.start();

    await push1(
      makeAnnouncement({
        pubkey,
        d: pubkey,
        u: ["https://mint.example.com"],
        createdAt: 1_700_000_500,
      }),
    );
    await settle();
    await sched1.stop();

    // Restart with a fresh pool. The new sub should carry since=1_700_000_500
    // for kind 38172.
    const { pool: pool2, subs: subs2 } = makeFakePool();
    const sched2 = createScheduler({ db, pool: pool2, fetcher, relays: ["wss://test"] });
    await sched2.start();

    // Find the subscription for kind 38172 and assert its `since` filter.
    const sub38172 = subs2.find((s) =>
      s.opts.filters.some((f: Filter) => f.kinds?.includes(38172)),
    );
    expect(sub38172).toBeDefined();
    const filter38172 = sub38172?.opts.filters.find((f: Filter) => f.kinds?.includes(38172));
    expect(filter38172?.since).toBe(1_700_000_500);

    await sched2.stop();
  });

  it("idempotency: replaying an already-cached event on restart yields no double-fetches and no duplicates", async () => {
    const db = await freshDB();
    const pubkey = "02".padEnd(66, "d");
    const event = makeAnnouncement({
      pubkey,
      d: pubkey,
      u: ["https://mint.example.com"],
      createdAt: 1_700_000_700,
    });

    const { pool: pool1, pushEvent: push1 } = makeFakePool();
    const { fetcher: fetcher1, calls: calls1 } = makeFetcher({
      "https://mint.example.com": pubkey,
    });
    const sched1 = createScheduler({
      db,
      pool: pool1,
      fetcher: fetcher1,
      relays: ["wss://test"],
    });
    await sched1.start();
    await push1(event);
    await settle();
    await sched1.stop();
    expect(calls1.length).toBe(1);
    expect(await db.announcements.count()).toBe(1);

    // Second pass — same event, fresh scheduler. The cache CAS should
    // reject the duplicate (rejected-stale) and Layer B should NOT re-run
    // (verifiedBySignerBinding was set true on round 1, and CAS-rejected
    // events don't enqueue Layer B).
    const { pool: pool2, pushEvent: push2 } = makeFakePool();
    const { fetcher: fetcher2, calls: calls2 } = makeFetcher({
      "https://mint.example.com": pubkey,
    });
    const sched2 = createScheduler({
      db,
      pool: pool2,
      fetcher: fetcher2,
      relays: ["wss://test"],
    });
    await sched2.start();
    await push2(event);
    await settle();
    await sched2.stop();

    expect(calls2.length).toBe(0); // no double Layer B
    expect(await db.announcements.count()).toBe(1); // no duplicate rows
    const row = await db.announcements.get([pubkey, 38172, pubkey]);
    expect(row?.verifiedBySignerBinding).toBe(true); // preserved across replay
  });
});

describe("scheduler — Layer B backoff", () => {
  it("a failed Layer B URL is in cooldown and skipped if the same URL is re-enqueued within the window", async () => {
    const db = await freshDB();
    const { pool, pushEvent } = makeFakePool();
    const { fetcher, calls } = makeFetcher({ "https://broken.example.com": "fail" });
    let mockNow = 1_700_000_000_000;
    const sched = createScheduler({
      db,
      pool,
      fetcher,
      relays: ["wss://test"],
      now: () => mockNow,
    });
    await sched.start();

    const pubkey = "02".padEnd(66, "e");
    // First event: Layer B runs, fails, schedules backoff.
    await pushEvent(
      makeAnnouncement({
        pubkey,
        d: pubkey,
        u: ["https://broken.example.com"],
        createdAt: 1_700_000_000,
        eventId: "ev1",
      }),
    );
    await settle();
    expect(calls.length).toBe(1);
    expect(sched.getStats().layerBFailed).toBe(1);

    // Second event: same mint, newer createdAt, same URL — should be in
    // cooldown and the fetcher should NOT be called again.
    mockNow += 1000; // 1s later, well within 30s base backoff
    await pushEvent(
      makeAnnouncement({
        pubkey,
        d: pubkey,
        u: ["https://broken.example.com"],
        createdAt: 1_700_000_001,
        eventId: "ev2",
      }),
    );
    await settle();
    expect(calls.length).toBe(1); // unchanged
    expect(sched.getStats().layerBFailed).toBe(1); // unchanged

    // After 31s the URL is allowed to be retried.
    mockNow += 31_000;
    await pushEvent(
      makeAnnouncement({
        pubkey,
        d: pubkey,
        u: ["https://broken.example.com"],
        createdAt: 1_700_000_002,
        eventId: "ev3",
      }),
    );
    await settle();
    expect(calls.length).toBe(2); // retried
    expect(sched.getStats().layerBFailed).toBe(2);

    await sched.stop();
  });
});

describe("scheduler — drain on stop", () => {
  it("stop() awaits in-flight Layer B promises", async () => {
    const db = await freshDB();
    const { pool, pushEvent } = makeFakePool();

    // Fetcher hangs until we release it. Use a bag so the type narrows
    // to a concrete call signature for the resolve.
    const releasers: Array<(r: MintInfoResult) => void> = [];
    const fetcher: MintInfoFetcher = () =>
      new Promise<MintInfoResult>((resolve) => {
        releasers.push(resolve);
      });

    const sched = createScheduler({ db, pool, fetcher, relays: ["wss://test"] });
    await sched.start();

    const pubkey = "02".padEnd(66, "f");
    await pushEvent(makeAnnouncement({ pubkey, d: pubkey, u: ["https://mint.example.com"] }));
    await settle();

    // Inflight should be 1 now.
    expect(sched.getStats().layerBPending).toBe(1);

    // Initiate stop — should not resolve until we release the fetcher.
    let stopResolved = false;
    const stopPromise = sched.stop().then(() => {
      stopResolved = true;
    });
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(stopResolved).toBe(false);

    // Release the fetcher — Layer B completes, stop() resolves.
    releasers[0]?.({ ok: true, info: { pubkey } });
    await stopPromise;
    expect(stopResolved).toBe(true);
    expect(sched.getStats().layerBPending).toBe(0);
  });
});
