/**
 * End-to-end integration tests for the parse → cache pipeline.
 *
 * These pin the cross-cutting contracts the unit tests can't: that the
 * curated NIP-87 corpus actually flows through parseMintAnnouncement /
 * parseReview into upsertAnnouncement / upsertReview the way the design
 * says it should.
 *
 * fake-indexeddb is loaded in vitest.setup.ts.
 */
import type { Event as NostrEvent } from "nostr-tools/core";
import type { Filter } from "nostr-tools/filter";
import { afterEach, describe, expect, it } from "vitest";
import { type AnnouncementRow, BitcoinmintsDB, upsertAnnouncement, upsertReview } from "./cache";
import type { MintInfoFetcher, MintInfoResult } from "./cashu/info";
import fixtures from "./nip87/__fixtures__/nip87-sample.json" with { type: "json" };
import { isValidCashuDTag } from "./nip87/dtag";
import { parseMintAnnouncement } from "./nip87/parse";
import type { Pool, PoolHandle, SubscribeOptions } from "./nostr";
import { parseReview } from "./reviews/parse";
import { createScheduler } from "./scheduler";

type Fixture = {
  _meta: Record<string, unknown>;
  cashu38172BotSpam: NostrEvent[];
  cashu38172Legacy: NostrEvent[];
  cashu38172SpecConforming: NostrEvent[];
  fedimint38173: NostrEvent[];
  recommendations38000: NostrEvent[];
};
const f = fixtures as unknown as Fixture;

const freshName = () => `test-integration-${Math.random().toString(36).slice(2)}`;
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

/**
 * Convert a parsed MintAnnouncement to the cache row shape. The parser and
 * cache types are deliberately separate (see schema.ts comment), so this
 * adapter is what real ingest code will use.
 */
function toAnnouncementRow(
  parsed: NonNullable<ReturnType<typeof parseMintAnnouncement>>,
): AnnouncementRow {
  return {
    pubkey: parsed.pubkey,
    kind: parsed.kind,
    d: parsed.d,
    eventId: parsed.eventId,
    createdAt: parsed.createdAt,
    u: parsed.u,
    nuts: parsed.nuts,
    modules: parsed.modules,
    n: parsed.n,
    content: parsed.raw.content,
    rawTags: parsed.raw.tags,
    verifiedBySignerBinding: null,
  };
}

/**
 * Replay every event in the corpus through the parse → upsert pipeline and
 * collect the per-event outcome for assertions. Uses `parseReview`
 * (cache-layer parser) — the strict one production code routes through.
 */
async function replayCorpus(db: BitcoinmintsDB) {
  const all38172: NostrEvent[] = [
    ...f.cashu38172BotSpam,
    ...f.cashu38172Legacy,
    ...f.cashu38172SpecConforming,
  ];
  const announcementResults: { event: NostrEvent; result: string | "parse-failed" }[] = [];
  for (const e of [...all38172, ...f.fedimint38173]) {
    const parsed = parseMintAnnouncement(e);
    if (!parsed) {
      announcementResults.push({ event: e, result: "parse-failed" });
      continue;
    }
    const result = await upsertAnnouncement(db, toAnnouncementRow(parsed));
    announcementResults.push({ event: e, result });
  }

  const reviewResults: { event: NostrEvent; result: string | "parse-failed" }[] = [];
  for (const e of f.recommendations38000) {
    const row = parseReview(e);
    if (!row) {
      reviewResults.push({ event: e, result: "parse-failed" });
      continue;
    }
    const result = await upsertReview(db, row);
    reviewResults.push({ event: e, result });
  }

  return { announcementResults, reviewResults };
}

describe("integration: corpus replay → parse → cache", () => {
  it("replays all 16 corpus events and converges to the expected cache state", async () => {
    const db = await freshDB();
    const { announcementResults, reviewResults } = await replayCorpus(db);

    // Sanity: every event in the corpus has a result entry.
    expect(announcementResults.length).toBe(
      f.cashu38172BotSpam.length +
        f.cashu38172Legacy.length +
        f.cashu38172SpecConforming.length +
        f.fedimint38173.length,
    );
    expect(reviewResults.length).toBe(f.recommendations38000.length);

    // No parse failures — the curated corpus is well-formed (every event
    // has d + at least one u tag).
    for (const r of announcementResults) expect(r.result).not.toBe("parse-failed");
    for (const r of reviewResults) expect(r.result).not.toBe("parse-failed");

    // Per the fixture's _meta.notes:
    //   "Accepted: all cashu38172Legacy + cashu38172SpecConforming.
    //    Rejected: cashu38172BotSpam only."
    // Plus all 3 Fedimint events bypass Layer A.
    // Accepted = 1 (Legacy x-only) + 2 (SpecConforming compressed) + 3 (Fedimint) = 6
    // Rejected by Layer A = 5 (bot-spam only).
    const acceptedCashuLayerA = f.cashu38172Legacy.length + f.cashu38172SpecConforming.length;
    const acceptedFedimint = f.fedimint38173.length;
    const expectedAccepted = acceptedCashuLayerA + acceptedFedimint;
    const expectedRejected = f.cashu38172BotSpam.length;
    expect(expectedAccepted).toBe(6);
    expect(expectedRejected).toBe(5);

    // Cache state assertions.
    expect(await db.announcements.count()).toBe(expectedAccepted);

    // Result-stream assertions: every accepted event lands as 'inserted'
    // (each has unique [pubkey,kind,d]); every bot-spam lands as
    // 'rejected-invalid' (Layer A gate).
    const inserted = announcementResults.filter((r) => r.result === "inserted");
    const rejectedInvalid = announcementResults.filter((r) => r.result === "rejected-invalid");
    expect(inserted.length).toBe(expectedAccepted);
    expect(rejectedInvalid.length).toBe(expectedRejected);

    // Reviews: all 5 recommendations parse, but Layer A applies to the
    // reviews' `d` tag too (PR #5) — 2 of the 5 point at 16-char legacy
    // d-tags that pre-date the Cashu-mint-pubkey d-tag convention and
    // would be indistinguishable from the bot-spam shape the gate is
    // designed to reject. Those are `rejected-invalid`. The remaining 3
    // reference real 64-char Cashu mint pubkeys and insert cleanly.
    const reviewsInserted = reviewResults.filter((r) => r.result === "inserted");
    const reviewsRejectedInvalid = reviewResults.filter((r) => r.result === "rejected-invalid");
    expect(reviewsInserted.length).toBe(3);
    expect(reviewsRejectedInvalid.length).toBe(2);
    expect(await db.reviews.count()).toBe(3);
  });

  it("the legacy Nostrodomo (64-char x-only) lands as inserted, not rejected-invalid", async () => {
    // Spot-check Path 1 of the relaxed Layer A regex actually fires E2E.
    const db = await freshDB();
    const legacy = f.cashu38172Legacy[0];
    expect(legacy).toBeDefined();
    if (!legacy) return;
    const parsed = parseMintAnnouncement(legacy);
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    expect(parsed.d.length).toBe(64);
    expect(isValidCashuDTag(parsed.d)).toBe(true);
    const result = await upsertAnnouncement(db, toAnnouncementRow(parsed));
    expect(result).toBe("inserted");
  });
});

describe("integration: CAS convergence under simulated multi-relay race", () => {
  it("multi-relay echo of the same event id: 1 row, 1 inserted + 2 rejected-stale, deterministic", async () => {
    // Three relays publish the same canonical event. Same id, same key,
    // same createdAt — the equal-eventId loses the tiebreak (next > prev is
    // false), so re-broadcasts always end as 'rejected-stale'. No churn.
    const legacy = f.cashu38172Legacy[0];
    expect(legacy).toBeDefined();
    if (!legacy) return;
    const parsed = parseMintAnnouncement(legacy);
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    const row = toAnnouncementRow(parsed);

    const db = await freshDB();
    const results = await Promise.all([
      upsertAnnouncement(db, row),
      upsertAnnouncement(db, row),
      upsertAnnouncement(db, row),
    ]);

    expect(await db.announcements.count()).toBe(1);
    const inserted = results.filter((r) => r === "inserted");
    const stale = results.filter((r) => r === "rejected-stale");
    expect(inserted.length).toBe(1);
    expect(stale.length).toBe(2);
  });

  it("tiebreak under race: 3 events with same [pubkey,kind,d,createdAt] but different eventIds — highest eventId always wins, 10 shuffled trials", async () => {
    // Real-world: same logical replaceable event published by the same
    // signer at the same second but with different ids (e.g. retried after
    // a sig collision, or re-emitted by a buggy client). The lex-highest
    // eventId must win deterministically every time, regardless of arrival
    // order.
    const legacy = f.cashu38172Legacy[0];
    expect(legacy).toBeDefined();
    if (!legacy) return;
    const parsed = parseMintAnnouncement(legacy);
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    const baseRow = toAnnouncementRow(parsed);
    const eidLow = `${"0".repeat(60)}1111`;
    const eidMid = `${"0".repeat(60)}5555`;
    const eidHigh = `${"0".repeat(60)}ffff`;

    for (let trial = 0; trial < 10; trial++) {
      const db = await freshDB();
      const variants: AnnouncementRow[] = [
        { ...baseRow, eventId: eidLow, content: "lo" },
        { ...baseRow, eventId: eidMid, content: "mid" },
        { ...baseRow, eventId: eidHigh, content: "hi" },
      ];
      // Fisher-Yates shuffle — different arrival order each trial.
      for (let i = variants.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = variants[i] as AnnouncementRow;
        const swap = variants[j] as AnnouncementRow;
        variants[i] = swap;
        variants[j] = tmp;
      }
      await Promise.all(variants.map((v) => upsertAnnouncement(db, v)));

      expect(await db.announcements.count()).toBe(1);
      const fetched = await db.announcements.get([baseRow.pubkey, baseRow.kind, baseRow.d]);
      expect(fetched?.eventId).toBe(eidHigh);
      expect(fetched?.content).toBe("hi");
    }
  });
});

describe("integration: Layer A enforced at cache, not parser", () => {
  it("bot-spam events parse successfully but are rejected by upsertAnnouncement", async () => {
    // Pin the design choice: parser is lenient, the cache is the gate. This
    // matters because downstream code (e.g. raw-event log, debugger views)
    // can still see what came over the wire even if it never lands.
    const db = await freshDB();
    let parsedCount = 0;
    let rejectedAtCacheCount = 0;
    for (const e of f.cashu38172BotSpam) {
      const parsed = parseMintAnnouncement(e);
      // Parser does NOT gate on Layer A — every bot-spam event parses fine.
      expect(parsed).not.toBeNull();
      if (!parsed) continue;
      parsedCount++;
      // Bot-spam d-tags are 16-char random — regex doesn't match.
      expect(isValidCashuDTag(parsed.d)).toBe(false);
      const result = await upsertAnnouncement(db, toAnnouncementRow(parsed));
      // The cache is where Layer A bites.
      expect(result).toBe("rejected-invalid");
      rejectedAtCacheCount++;
    }
    expect(parsedCount).toBe(f.cashu38172BotSpam.length);
    expect(rejectedAtCacheCount).toBe(f.cashu38172BotSpam.length);
    // Nothing landed despite all 5 parsing successfully — design contract held.
    expect(await db.announcements.count()).toBe(0);
  });

  it("the same Layer A check lets valid events through when the parser hands them off", async () => {
    // Mirror of the above for the positive side — valid parses that land.
    const db = await freshDB();
    const allValid: NostrEvent[] = [...f.cashu38172Legacy, ...f.cashu38172SpecConforming];
    for (const e of allValid) {
      const parsed = parseMintAnnouncement(e);
      expect(parsed).not.toBeNull();
      if (!parsed) continue;
      expect(isValidCashuDTag(parsed.d)).toBe(true);
      const result = await upsertAnnouncement(db, toAnnouncementRow(parsed));
      expect(result).toBe("inserted");
    }
    expect(await db.announcements.count()).toBe(allValid.length);
  });
});

// ── Scheduler integration ────────────────────────────────────────────────
//
// The above tests prove parse → cache. The scheduler is the production
// orchestrator that adds Layer B and watermark restore on top — these
// tests pin that running the corpus through `createScheduler` produces
// the same final cache state PLUS the right verifiedBySignerBinding
// values, the right mintInfo rows, and the right stats counters.
//
// We use a fake pool and a deterministic fetcher so the only randomness
// is the corpus itself (and a Fisher-Yates shuffle in the race test, but
// only inside the cache layer which has its own coverage above).

type FakeSub = { opts: SubscribeOptions; handle: PoolHandle; closed: boolean };

function makeFakePool(): {
  pool: Pool;
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
    async pushEvent(event: NostrEvent) {
      for (const sub of subs) {
        if (sub.closed) continue;
        const matches = sub.opts.filters.some((filter: Filter) =>
          filter.kinds?.includes(event.kind),
        );
        if (matches) {
          sub.opts.onEvent(event, "wss://test.relay");
          // Yield once per push so the async handler can complete its DB
          // writes before the next event arrives.
          await new Promise<void>((r) => setTimeout(r, 0));
        }
      }
    },
  };
}

/**
 * Drain Layer B work. Poll `layerBPending` until 0 (or timeout) — robust
 * against the per-task transaction wrapping that adds microtask hops.
 * The previous fixed 10-yield drain raced under slower CI runners.
 */
async function drainLayerB(sched?: { getStats: () => { layerBPending: number } }): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (sched && sched.getStats().layerBPending === 0 && i >= 5) return;
    await new Promise<void>((r) => setTimeout(r, 0));
  }
}

/**
 * Build a fetcher that responds with the right pubkey for the synthetic
 * spec-conforming mints (so Layer B verifies) and with a real-ish failure
 * for the legacy mint (so we can assert one verified + one failed branch).
 */
function makeCorpusFetcher(): MintInfoFetcher {
  // Map: url -> pubkey it should claim. Anything not in the map yields a
  // 404 result, exercising the all-fetches-failed reason.
  const mapping: Record<string, string> = {
    // SpecConforming mint Alpha — pubkey matches d-tag of the announcement.
    "https://mint.alpha.test": "02aa00000000000000000000000000000000000000000000000000000000000001",
    // SpecConforming mint Beta — second URL is the canonical one in the
    // announcement; primary URL also points at the right pubkey.
    "https://mint.beta.test": "03bb00000000000000000000000000000000000000000000000000000000000002",
    "https://mint.beta.test/v1":
      "03bb00000000000000000000000000000000000000000000000000000000000002",
    // Legacy Nostrodomo: pubkey deliberately mismatched so we exercise
    // the pubkey-mismatch failure branch.
    "https://mint.sharegap.net": "02deadbeef",
  };
  return async (url: string): Promise<MintInfoResult> => {
    const pk = mapping[url];
    if (pk === undefined) {
      return { ok: false, error: "non-2xx (404)", status: 404 };
    }
    return { ok: true, info: { pubkey: pk, name: `Mint at ${url}` } };
  };
}

/**
 * Push every Cashu + Fedimint announcement from the corpus through the
 * given pool, waiting for the scheduler's Layer B to drain.
 */
async function pushCashuCorpus(pushEvent: (e: NostrEvent) => Promise<void>): Promise<void> {
  const allCashu: NostrEvent[] = [
    ...f.cashu38172BotSpam,
    ...f.cashu38172Legacy,
    ...f.cashu38172SpecConforming,
  ];
  for (const e of allCashu) await pushEvent(e);
  for (const e of f.fedimint38173) await pushEvent(e);
  for (const e of f.recommendations38000) await pushEvent(e);
}

describe("integration: scheduler full pipeline", () => {
  it("runs the corpus through createScheduler and converges with Layer B applied", async () => {
    const db = await freshDB();
    const { pool, pushEvent } = makeFakePool();
    const fetcher = makeCorpusFetcher();
    const sched = createScheduler({ db, pool, fetcher, relays: ["wss://test.relay"] });
    await sched.start();

    await pushCashuCorpus(pushEvent);
    await drainLayerB(sched);

    // Stats: same accept/reject as the parse → cache integration above
    // (5 bot-spam rejected at Layer A; 1 legacy + 2 spec-conforming + 3
    // fedimint accepted = 6 announcements; 3 reviews accepted + 2 reviews
    // rejected for 16-char legacy d-tags per PR #5's Layer A review gate).
    const stats = sched.getStats();
    // 11 announcements (5 spam + 1 legacy + 2 spec + 3 fedi) + 5 reviews = 16.
    expect(stats.eventsReceived).toBe(16);
    // 5 announcement bot-spam rejections + 2 review 16-char d-tag rejections.
    expect(stats.rejectedByLayerA).toBe(7);
    // Accepted = 6 announcements + 3 reviews = 9.
    expect(stats.accepted).toBe(9);

    // Layer B: spec-conforming Alpha + Beta verify. Legacy Nostrodomo
    // returns ok but with the wrong pubkey → counts as failed. Fedimint
    // is non-cashu and doesn't enqueue Layer B at all.
    expect(stats.layerBVerified).toBe(2);
    expect(stats.layerBFailed).toBe(1);
    expect(stats.layerBPending).toBe(0);

    // Cache state matches the parse → cache test exactly: 6 announcements,
    // 3 reviews (2 more reviews rejected by PR #5's Layer A on reviews'
    // d-tags). Bot-spam rejected at Layer A, never lands.
    expect(await db.announcements.count()).toBe(6);
    expect(await db.reviews.count()).toBe(3);

    // Spot-check verifiedBySignerBinding wired through correctly.
    const alphaPubkey = "02aa00000000000000000000000000000000000000000000000000000000000001";
    const alpha = await db.announcements.get([alphaPubkey, 38172, alphaPubkey]);
    expect(alpha?.verifiedBySignerBinding).toBe(true);

    const betaPubkey = "03bb00000000000000000000000000000000000000000000000000000000000002";
    const beta = await db.announcements.get([betaPubkey, 38172, betaPubkey]);
    expect(beta?.verifiedBySignerBinding).toBe(true);

    const legacyPubkey = "5fe928ae0970844f3c5253d2e85a88788486edcbd96c070334a4a2d0d0154a77";
    const legacy = await db.announcements.get([legacyPubkey, 38172, legacyPubkey]);
    expect(legacy?.verifiedBySignerBinding).toBe(false);

    // Fedimint announcements are accepted but Layer B doesn't run, so the
    // field stays null (not false — null distinguishes "didn't try" from
    // "tried and failed").
    const fedimintRow = await db.announcements.where("kind").equals(38173).first();
    expect(fedimintRow).toBeDefined();
    expect(fedimintRow?.verifiedBySignerBinding).toBeNull();

    // mintInfo rows: 2 ok (Alpha, Beta) + 1 !ok (Legacy mismatch).
    expect(await db.mintInfo.count()).toBe(3);
    const alphaInfo = await db.mintInfo.get(alphaPubkey);
    expect(alphaInfo?.ok).toBe(true);
    expect(alphaInfo?.url).toBe("https://mint.alpha.test");
    const legacyInfo = await db.mintInfo.get(legacyPubkey);
    expect(legacyInfo?.ok).toBe(false);
    expect(legacyInfo?.lastError).toContain("pubkey-mismatch");

    await sched.stop();
  });

  it("idempotency: stop and re-start replays the corpus with no double-fetches and no duplicate rows", async () => {
    // Run the corpus through scheduler 1, stop, then run the same corpus
    // through scheduler 2 against the same DB. The CAS should reject all
    // duplicates as 'rejected-stale' (not 'replaced' since createdAt is
    // identical), Layer B should NOT re-fetch (the fetcher's cache is per-
    // process, but cross-restart we rely on backoff-skip-on-replace + the
    // 'replaced'/'rejected-stale' branch never enqueueing Layer B).
    const db = await freshDB();

    // Round 1.
    const { pool: pool1, pushEvent: push1 } = makeFakePool();
    const calls1: string[] = [];
    const baseFetcher = makeCorpusFetcher();
    const fetcher1: MintInfoFetcher = (url) => {
      calls1.push(url);
      return baseFetcher(url);
    };
    const sched1 = createScheduler({
      db,
      pool: pool1,
      fetcher: fetcher1,
      relays: ["wss://test.relay"],
    });
    await sched1.start();
    await pushCashuCorpus(push1);
    await drainLayerB(sched1);
    await sched1.stop();

    const round1Counts = {
      announcements: await db.announcements.count(),
      reviews: await db.reviews.count(),
      mintInfo: await db.mintInfo.count(),
      fetches: calls1.length,
    };
    expect(round1Counts.announcements).toBe(6);
    // 3 reviews (2 more gated out by PR #5's Layer A on review d-tags).
    expect(round1Counts.reviews).toBe(3);
    expect(round1Counts.mintInfo).toBe(3);

    // Round 2 — fresh scheduler against same DB. createScheduler reads
    // the watermarks from the cache; the corpus replay uses the same
    // events (same createdAt), so every announcement upsert lands as
    // 'rejected-stale' (next.createdAt is NOT > prev.createdAt) which
    // means Layer B is not re-enqueued, so calls2 stays at 0.
    const { pool: pool2, pushEvent: push2 } = makeFakePool();
    const calls2: string[] = [];
    const fetcher2: MintInfoFetcher = (url) => {
      calls2.push(url);
      return baseFetcher(url);
    };
    const sched2 = createScheduler({
      db,
      pool: pool2,
      fetcher: fetcher2,
      relays: ["wss://test.relay"],
    });
    await sched2.start();
    await pushCashuCorpus(push2);
    await drainLayerB(sched2);
    await sched2.stop();

    // Same row counts — no duplicates introduced by the replay.
    expect(await db.announcements.count()).toBe(round1Counts.announcements);
    expect(await db.reviews.count()).toBe(round1Counts.reviews);
    expect(await db.mintInfo.count()).toBe(round1Counts.mintInfo);

    // No second-round Layer B fetches: each 'rejected-stale' upsert short-
    // circuits the enqueue path.
    expect(calls2.length).toBe(0);

    // Verification status preserved across restart (PR #29 fix on the
    // cache + scheduler not clobbering on replace).
    const alphaPubkey = "02aa00000000000000000000000000000000000000000000000000000000000001";
    const alpha = await db.announcements.get([alphaPubkey, 38172, alphaPubkey]);
    expect(alpha?.verifiedBySignerBinding).toBe(true);
  });
});
