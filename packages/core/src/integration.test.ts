/**
 * End-to-end integration tests for the parse → cache pipeline.
 *
 * These pin the cross-cutting contracts the unit tests can't: that the
 * curated NIP-87 corpus actually flows through parseMintAnnouncement /
 * parseRecommendation into upsertAnnouncement / upsertReview the way the
 * design says it should.
 *
 * fake-indexeddb is loaded in vitest.setup.ts.
 */
import type { Event as NostrEvent } from "nostr-tools/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  type AnnouncementRow,
  BitcoinmintsDB,
  type ReviewRow,
  upsertAnnouncement,
  upsertReview,
} from "./cache";
import fixtures from "./nip87/__fixtures__/nip87-sample.json" with { type: "json" };
import { isValidCashuDTag } from "./nip87/dtag";
import { parseMintAnnouncement, parseRecommendation } from "./nip87/parse";

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

function toReviewRow(parsed: NonNullable<ReturnType<typeof parseRecommendation>>): ReviewRow {
  return {
    pubkey: parsed.pubkey,
    kind: 38000,
    d: parsed.d,
    eventId: parsed.eventId,
    createdAt: parsed.createdAt,
    k: parsed.k,
    rating: parsed.rating,
    content: parsed.content,
    rawTags: parsed.raw.tags,
  };
}

/**
 * Replay every event in the corpus through the parse → upsert pipeline and
 * collect the per-event outcome for assertions.
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
    const parsed = parseRecommendation(e);
    if (!parsed) {
      reviewResults.push({ event: e, result: "parse-failed" });
      continue;
    }
    const result = await upsertReview(db, toReviewRow(parsed));
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

    // Reviews: all 5 recommendations parse and insert (each has unique
    // [pubkey,38000,d]).
    expect(await db.reviews.count()).toBe(f.recommendations38000.length);
    expect(await db.reviews.count()).toBe(5);
    const reviewsInserted = reviewResults.filter((r) => r.result === "inserted");
    expect(reviewsInserted.length).toBe(5);
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
