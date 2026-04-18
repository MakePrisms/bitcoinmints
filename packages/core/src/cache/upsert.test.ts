import { afterEach, describe, expect, it } from "vitest";
import type {
  AnnouncementRow,
  MintAggregateRow,
  MintInfoRow,
  ProfileRow,
  RelayListRow,
  ReviewRow,
} from "./schema";
import { BitcoinmintsDB } from "./schema";
import {
  upsertAnnouncement,
  upsertMintAggregate,
  upsertMintInfo,
  upsertProfile,
  upsertRelayList,
  upsertReview,
} from "./upsert";

const freshName = () => `test-upsert-${Math.random().toString(36).slice(2)}`;

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

/** Realistic 64-char x-only Cashu d-tag (de-facto form — Nostrodomo). */
const D_XONLY = "5fe928ae0970844f3c5253d2e85a88788486edcbd96c070334a4a2d0d0154a77";
/** Realistic 66-char compressed Cashu d-tag. */
const D_COMPRESSED = `02${"a".repeat(64)}`;
/** Event id space — 64-char hex strings; lexicographic compare on lowercase hex. */
const EID_LOW = `${"0".repeat(60)}aaaa`;
const EID_HIGH = `${"0".repeat(60)}ffff`;

function makeAnnouncement(over: Partial<AnnouncementRow> = {}): AnnouncementRow {
  return {
    pubkey: `pk-${"0".repeat(60)}1111`,
    kind: 38172,
    d: D_XONLY,
    eventId: EID_LOW,
    createdAt: 1_700_000_000,
    u: ["https://mint.example"],
    nuts: [1, 2, 3],
    content: "",
    rawTags: [],
    verifiedBySignerBinding: null,
    ...over,
  };
}

function makeReview(over: Partial<ReviewRow> = {}): ReviewRow {
  // Default to a 64-char hex reviewer pubkey so the synthetic `a` tag below
  // satisfies the parse-layer's hex-pubkey check (mirrors what real
  // upstream-of-cache flows produce).
  const reviewer = `${"f".repeat(60)}2222`;
  const d = over.d ?? D_XONLY;
  const k = (over.k ?? 38172) as 38172 | 38173;
  return {
    pubkey: reviewer,
    kind: 38000,
    d,
    eventId: EID_LOW,
    createdAt: 1_700_000_000,
    k,
    a: `${k}:${reviewer}:${d}`,
    rating: 5,
    content: "[5/5] good mint",
    rawTags: [],
    ...over,
  };
}

function makeProfile(over: Partial<ProfileRow> = {}): ProfileRow {
  return {
    pubkey: `pk-${"0".repeat(60)}3333`,
    eventId: EID_LOW,
    createdAt: 1_700_000_000,
    name: "alice",
    rawContent: '{"name":"alice"}',
    ...over,
  };
}

function makeRelayList(over: Partial<RelayListRow> = {}): RelayListRow {
  return {
    pubkey: `pk-${"0".repeat(60)}4444`,
    eventId: EID_LOW,
    createdAt: 1_700_000_000,
    relays: [{ url: "wss://relay.example", read: true, write: true }],
    ...over,
  };
}

function makeMintInfo(over: Partial<MintInfoRow> = {}): MintInfoRow {
  return {
    d: D_XONLY,
    url: "https://mint.example/v1/info",
    fetchedAt: 1_700_000_000,
    infoJson: { name: "Example Mint" },
    ok: true,
    ...over,
  };
}

function makeMintAggregate(over: Partial<MintAggregateRow> = {}): MintAggregateRow {
  return {
    d: D_XONLY,
    reviewCount: 5,
    ratedCount: 5,
    avgRating: 4.2,
    bayesianScore: 3.8,
    updatedAt: 1_700_000_000,
    ...over,
  };
}

describe("upsertAnnouncement", () => {
  it("inserts a brand-new row", async () => {
    const db = await freshDB();
    const row = makeAnnouncement();

    const result = await upsertAnnouncement(db, row);
    expect(result).toBe("inserted");

    const fetched = await db.announcements.get([row.pubkey, row.kind, row.d]);
    expect(fetched).toEqual(row);
    expect(await db.announcements.count()).toBe(1);
  });

  it("replaces on newer createdAt", async () => {
    const db = await freshDB();
    const older = makeAnnouncement({ createdAt: 1000, content: "older" });
    const newer = makeAnnouncement({ createdAt: 2000, content: "newer" });

    expect(await upsertAnnouncement(db, older)).toBe("inserted");
    expect(await upsertAnnouncement(db, newer)).toBe("replaced");

    const fetched = await db.announcements.get([newer.pubkey, newer.kind, newer.d]);
    expect(fetched?.content).toBe("newer");
    expect(await db.announcements.count()).toBe(1);
  });

  it("rejects as stale on older createdAt", async () => {
    const db = await freshDB();
    const newer = makeAnnouncement({ createdAt: 2000, content: "newer" });
    const older = makeAnnouncement({ createdAt: 1000, content: "older" });

    expect(await upsertAnnouncement(db, newer)).toBe("inserted");
    expect(await upsertAnnouncement(db, older)).toBe("rejected-stale");

    const fetched = await db.announcements.get([newer.pubkey, newer.kind, newer.d]);
    expect(fetched?.content).toBe("newer");
  });

  it("replaces when createdAt ties and eventId is lower lexicographically (NIP-01: lowest id wins)", async () => {
    // NIP-01: "In case of replaceable events with the same timestamp, the
    // event with the lowest id (first in lexical order) should be retained."
    const db = await freshDB();
    const hiEid = makeAnnouncement({ eventId: EID_HIGH, content: "hi" });
    const loEid = makeAnnouncement({ eventId: EID_LOW, content: "lo" });

    expect(await upsertAnnouncement(db, hiEid)).toBe("inserted");
    expect(await upsertAnnouncement(db, loEid)).toBe("replaced");

    const fetched = await db.announcements.get([hiEid.pubkey, hiEid.kind, hiEid.d]);
    expect(fetched?.eventId).toBe(EID_LOW);
    expect(fetched?.content).toBe("lo");
  });

  it("rejects as stale when createdAt ties and eventId is higher lexicographically (NIP-01: lowest id wins)", async () => {
    const db = await freshDB();
    const loEid = makeAnnouncement({ eventId: EID_LOW, content: "lo" });
    const hiEid = makeAnnouncement({ eventId: EID_HIGH, content: "hi" });

    expect(await upsertAnnouncement(db, loEid)).toBe("inserted");
    expect(await upsertAnnouncement(db, hiEid)).toBe("rejected-stale");

    const fetched = await db.announcements.get([loEid.pubkey, loEid.kind, loEid.d]);
    expect(fetched?.eventId).toBe(EID_LOW);
  });

  it("rejects as invalid when kind:38172 has a 16-char bot-spam d-tag", async () => {
    const db = await freshDB();
    const bot = makeAnnouncement({ d: "abc123def4567890" });

    const result = await upsertAnnouncement(db, bot);
    expect(result).toBe("rejected-invalid");
    expect(await db.announcements.count()).toBe(0);
  });

  it("inserts kind:38172 with a valid 64-char x-only d-tag (Path 1 relaxation)", async () => {
    const db = await freshDB();
    const row = makeAnnouncement({ d: D_XONLY });

    expect(await upsertAnnouncement(db, row)).toBe("inserted");
    const fetched = await db.announcements.get([row.pubkey, row.kind, row.d]);
    expect(fetched?.d).toBe(D_XONLY);
    expect(fetched?.d.length).toBe(64);
  });

  it("inserts kind:38172 with a valid 66-char compressed d-tag", async () => {
    const db = await freshDB();
    const row = makeAnnouncement({ d: D_COMPRESSED });

    expect(await upsertAnnouncement(db, row)).toBe("inserted");
    const fetched = await db.announcements.get([row.pubkey, row.kind, row.d]);
    expect(fetched?.d.length).toBe(66);
    expect(fetched?.d).toBe(D_COMPRESSED);
  });

  it("inserts kind:38173 (Fedimint) bypassing Layer A — federation IDs are shaped differently", async () => {
    const db = await freshDB();
    // Fedimint federation id — 64 hex but semantically not a Cashu pubkey.
    const fediId = "718e421be177486639330d198e870b7345ebd07b2866b5fd3797d73e4bc4c9af";
    const row = makeAnnouncement({
      kind: 38173,
      d: fediId,
      nuts: undefined,
      modules: ["ln", "mint", "wallet"],
    });

    expect(await upsertAnnouncement(db, row)).toBe("inserted");
    const fetched = await db.announcements.get([row.pubkey, 38173, fediId]);
    expect(fetched?.kind).toBe(38173);
    expect(fetched?.modules).toEqual(["ln", "mint", "wallet"]);
  });

  it("keeps separate rows for different pubkeys announcing the same (kind, d)", async () => {
    const db = await freshDB();
    const aliceRow = makeAnnouncement({ pubkey: "alice", content: "alice's view" });
    const bobRow = makeAnnouncement({ pubkey: "bob", content: "bob's view" });

    expect(await upsertAnnouncement(db, aliceRow)).toBe("inserted");
    expect(await upsertAnnouncement(db, bobRow)).toBe("inserted");

    expect(await db.announcements.count()).toBe(2);
    const alice = await db.announcements.get(["alice", aliceRow.kind, aliceRow.d]);
    const bob = await db.announcements.get(["bob", bobRow.kind, bobRow.d]);
    expect(alice?.content).toBe("alice's view");
    expect(bob?.content).toBe("bob's view");
  });

  it("keeps separate rows for same pubkey + kind but different d-tags", async () => {
    const db = await freshDB();
    const rowA = makeAnnouncement({ d: D_XONLY });
    const rowB = makeAnnouncement({ d: D_COMPRESSED });

    expect(await upsertAnnouncement(db, rowA)).toBe("inserted");
    expect(await upsertAnnouncement(db, rowB)).toBe("inserted");

    expect(await db.announcements.count()).toBe(2);
  });

  it("replaces when same pubkey, same kind, SAME d and the newcomer wins", async () => {
    const db = await freshDB();
    const original = makeAnnouncement({ d: D_XONLY, createdAt: 1000, content: "original" });
    const update = makeAnnouncement({ d: D_XONLY, createdAt: 2000, content: "update" });

    expect(await upsertAnnouncement(db, original)).toBe("inserted");
    expect(await upsertAnnouncement(db, update)).toBe("replaced");

    expect(await db.announcements.count()).toBe(1);
    const fetched = await db.announcements.get([original.pubkey, original.kind, D_XONLY]);
    expect(fetched?.content).toBe("update");
  });

  it("ingesting the same eventId 3x: 1 row, 1 inserted + 2 rejected-stale (no-op tiebreak)", async () => {
    const db = await freshDB();
    const row = makeAnnouncement({ d: D_XONLY, eventId: EID_LOW, createdAt: 1000 });

    const r1 = await upsertAnnouncement(db, row);
    const r2 = await upsertAnnouncement(db, row);
    const r3 = await upsertAnnouncement(db, row);

    // First wins, subsequent dupes lose tiebreak (next.eventId < prev.eventId is false on equal).
    expect(r1).toBe("inserted");
    expect(r2).toBe("rejected-stale");
    expect(r3).toBe("rejected-stale");
    expect(await db.announcements.count()).toBe(1);
    const fetched = await db.announcements.get([row.pubkey, row.kind, D_XONLY]);
    expect(fetched?.eventId).toBe(EID_LOW);
  });

  it("concurrent upserts of the same [pubkey,kind,d] always converge to the higher createdAt — shuffled order, 5 trials", async () => {
    // Two distinct events for the same parameterized-replaceable key, with
    // different createdAt. The transaction guarantees that whichever lands
    // second still sees the first's row and applies CAS correctly — there's
    // no "interleaved garbage state" where the older row wins by virtue of
    // arriving last.
    const lower = makeAnnouncement({
      d: D_XONLY,
      eventId: EID_LOW,
      createdAt: 1000,
      content: "lower",
    });
    const higher = makeAnnouncement({
      d: D_XONLY,
      eventId: EID_HIGH,
      createdAt: 2000,
      content: "higher",
    });

    for (let trial = 0; trial < 5; trial++) {
      const db = await freshDB();
      const ops =
        trial % 2 === 0
          ? [upsertAnnouncement(db, lower), upsertAnnouncement(db, higher)]
          : [upsertAnnouncement(db, higher), upsertAnnouncement(db, lower)];
      const results = await Promise.all(ops);

      // Convergence: exactly one row, the higher-createdAt event always wins.
      expect(await db.announcements.count()).toBe(1);
      const fetched = await db.announcements.get([higher.pubkey, higher.kind, D_XONLY]);
      expect(fetched?.content).toBe("higher");
      expect(fetched?.createdAt).toBe(2000);
      expect(fetched?.eventId).toBe(EID_HIGH);

      // Result composition: one inserted, one replaced/rejected depending on
      // which landed first inside the transaction queue. Either way, no
      // "rejected-invalid" and no double-insert.
      expect(results).toContain("inserted");
      const second = results.find((r) => r !== "inserted");
      expect(second === "replaced" || second === "rejected-stale").toBe(true);
    }
  });

  it("preserves verifiedBySignerBinding across a CAS replace (Layer B isn't clobbered by a newer parser-emitted row)", async () => {
    const db = await freshDB();
    const original = makeAnnouncement({ d: D_XONLY, createdAt: 1000, content: "original" });
    expect(await upsertAnnouncement(db, original)).toBe("inserted");

    // Simulate PR #4's Layer B verifier flipping the bit out-of-band (direct
    // db write — not via upsert).
    await db.announcements.update([original.pubkey, original.kind, D_XONLY], {
      verifiedBySignerBinding: true,
    });
    const afterVerify = await db.announcements.get([original.pubkey, original.kind, D_XONLY]);
    expect(afterVerify?.verifiedBySignerBinding).toBe(true);

    // Newer event arrives — parser doesn't know about Layer B, so it carries `null`.
    const update = makeAnnouncement({
      d: D_XONLY,
      createdAt: 2000,
      content: "update",
      verifiedBySignerBinding: null,
    });
    expect(await upsertAnnouncement(db, update)).toBe("replaced");

    const fetched = await db.announcements.get([original.pubkey, original.kind, D_XONLY]);
    // Newer fields land...
    expect(fetched?.content).toBe("update");
    expect(fetched?.createdAt).toBe(2000);
    // ...but Layer B verification is preserved.
    expect(fetched?.verifiedBySignerBinding).toBe(true);
  });
});

describe("upsertReview", () => {
  it("inserts a brand-new review", async () => {
    const db = await freshDB();
    const row = makeReview();

    expect(await upsertReview(db, row)).toBe("inserted");
    expect(await db.reviews.count()).toBe(1);
  });

  it("replaces on newer createdAt", async () => {
    const db = await freshDB();
    const older = makeReview({ createdAt: 1000, rating: 3 });
    const newer = makeReview({ createdAt: 2000, rating: 5 });

    expect(await upsertReview(db, older)).toBe("inserted");
    expect(await upsertReview(db, newer)).toBe("replaced");

    const fetched = await db.reviews.get([newer.pubkey, newer.kind, newer.d]);
    expect(fetched?.rating).toBe(5);
  });

  it("rejects on older createdAt", async () => {
    const db = await freshDB();
    const newer = makeReview({ createdAt: 2000, rating: 5 });
    const older = makeReview({ createdAt: 1000, rating: 3 });

    expect(await upsertReview(db, newer)).toBe("inserted");
    expect(await upsertReview(db, older)).toBe("rejected-stale");

    const fetched = await db.reviews.get([newer.pubkey, newer.kind, newer.d]);
    expect(fetched?.rating).toBe(5);
  });

  it("tiebreak: lower eventId replaces on createdAt tie (NIP-01: lowest id wins)", async () => {
    // NIP-01: "In case of replaceable events with the same timestamp, the
    // event with the lowest id (first in lexical order) should be retained."
    const db = await freshDB();
    const hiEid = makeReview({ eventId: EID_HIGH, rating: 5 });
    const loEid = makeReview({ eventId: EID_LOW, rating: 1 });

    expect(await upsertReview(db, hiEid)).toBe("inserted");
    expect(await upsertReview(db, loEid)).toBe("replaced");

    const fetched = await db.reviews.get([hiEid.pubkey, hiEid.kind, hiEid.d]);
    expect(fetched?.rating).toBe(1);
    expect(fetched?.eventId).toBe(EID_LOW);
  });

  it("tiebreak: higher eventId is rejected as stale on createdAt tie (NIP-01: lowest id wins)", async () => {
    const db = await freshDB();
    const loEid = makeReview({ eventId: EID_LOW, rating: 1 });
    const hiEid = makeReview({ eventId: EID_HIGH, rating: 5 });

    expect(await upsertReview(db, loEid)).toBe("inserted");
    expect(await upsertReview(db, hiEid)).toBe("rejected-stale");

    const fetched = await db.reviews.get([loEid.pubkey, loEid.kind, loEid.d]);
    expect(fetched?.rating).toBe(1);
  });

  it("keeps separate rows when the same reviewer reviews different mints", async () => {
    const db = await freshDB();
    const rowA = makeReview({ d: D_XONLY, content: "mint A review" });
    const rowB = makeReview({ d: D_COMPRESSED, content: "mint B review" });

    expect(await upsertReview(db, rowA)).toBe("inserted");
    expect(await upsertReview(db, rowB)).toBe("inserted");

    expect(await db.reviews.count()).toBe(2);
  });

  it("keeps separate rows when different reviewers review the same mint", async () => {
    const db = await freshDB();
    const alice = makeReview({ pubkey: "alice", content: "alice says" });
    const bob = makeReview({ pubkey: "bob", content: "bob says" });

    expect(await upsertReview(db, alice)).toBe("inserted");
    expect(await upsertReview(db, bob)).toBe("inserted");

    expect(await db.reviews.count()).toBe(2);
  });
});

describe("upsertProfile", () => {
  it("inserts, replaces on newer, rejects older", async () => {
    const db = await freshDB();
    const row1 = makeProfile({ createdAt: 1000, name: "alice-v1" });
    const row2 = makeProfile({ createdAt: 2000, name: "alice-v2" });
    const row3 = makeProfile({ createdAt: 500, name: "alice-ancient" });

    expect(await upsertProfile(db, row1)).toBe("inserted");
    expect(await upsertProfile(db, row2)).toBe("replaced");
    expect(await upsertProfile(db, row3)).toBe("rejected-stale");

    const fetched = await db.profiles.get(row1.pubkey);
    expect(fetched?.name).toBe("alice-v2");
  });

  it("tiebreak on eventId when createdAt ties (NIP-01: lowest id wins)", async () => {
    // NIP-01: "In case of replaceable events with the same timestamp, the
    // event with the lowest id (first in lexical order) should be retained."
    const db = await freshDB();
    const hi = makeProfile({ eventId: EID_HIGH, name: "hi" });
    const lo = makeProfile({ eventId: EID_LOW, name: "lo" });

    expect(await upsertProfile(db, hi)).toBe("inserted");
    expect(await upsertProfile(db, lo)).toBe("replaced");

    const backToHi = makeProfile({ eventId: EID_HIGH, name: "back-to-hi" });
    expect(await upsertProfile(db, backToHi)).toBe("rejected-stale");

    const fetched = await db.profiles.get(lo.pubkey);
    expect(fetched?.name).toBe("lo");
  });

  it("keeps one row per pubkey; different pubkeys are independent", async () => {
    const db = await freshDB();
    const alice = makeProfile({ pubkey: "alice" });
    const bob = makeProfile({ pubkey: "bob" });

    expect(await upsertProfile(db, alice)).toBe("inserted");
    expect(await upsertProfile(db, bob)).toBe("inserted");
    expect(await db.profiles.count()).toBe(2);
  });
});

describe("upsertRelayList", () => {
  it("inserts, replaces on newer, rejects older", async () => {
    const db = await freshDB();
    const row1 = makeRelayList({ createdAt: 1000 });
    const row2 = makeRelayList({
      createdAt: 2000,
      relays: [{ url: "wss://r2.example", read: true, write: false }],
    });
    const row3 = makeRelayList({ createdAt: 500 });

    expect(await upsertRelayList(db, row1)).toBe("inserted");
    expect(await upsertRelayList(db, row2)).toBe("replaced");
    expect(await upsertRelayList(db, row3)).toBe("rejected-stale");

    const fetched = await db.relayLists.get(row1.pubkey);
    expect(fetched?.relays[0]?.url).toBe("wss://r2.example");
    expect(fetched?.relays[0]?.write).toBe(false);
  });

  it("tiebreak on eventId when createdAt ties (NIP-01: lowest id wins)", async () => {
    // NIP-01: "In case of replaceable events with the same timestamp, the
    // event with the lowest id (first in lexical order) should be retained."
    const db = await freshDB();
    const hi = makeRelayList({ eventId: EID_HIGH });
    const lo = makeRelayList({
      eventId: EID_LOW,
      relays: [{ url: "wss://lo.example", read: true, write: true }],
    });

    expect(await upsertRelayList(db, hi)).toBe("inserted");
    expect(await upsertRelayList(db, lo)).toBe("replaced");

    const fetched = await db.relayLists.get(hi.pubkey);
    expect(fetched?.eventId).toBe(EID_LOW);
    expect(fetched?.relays[0]?.url).toBe("wss://lo.example");
  });
});

describe("upsertMintInfo", () => {
  it("inserts a brand-new mint-info row", async () => {
    const db = await freshDB();
    const row = makeMintInfo();
    expect(await upsertMintInfo(db, row)).toBe("inserted");
    expect(await db.mintInfo.count()).toBe(1);
  });

  it("replaces on newer fetchedAt", async () => {
    const db = await freshDB();
    const older = makeMintInfo({ fetchedAt: 1000, infoJson: { v: 1 } });
    const newer = makeMintInfo({ fetchedAt: 2000, infoJson: { v: 2 } });

    expect(await upsertMintInfo(db, older)).toBe("inserted");
    expect(await upsertMintInfo(db, newer)).toBe("replaced");

    const fetched = await db.mintInfo.get(older.d);
    expect(fetched?.infoJson).toEqual({ v: 2 });
    expect(fetched?.fetchedAt).toBe(2000);
  });

  it("rejects on older fetchedAt", async () => {
    const db = await freshDB();
    const newer = makeMintInfo({ fetchedAt: 2000, infoJson: { v: 2 } });
    const older = makeMintInfo({ fetchedAt: 1000, infoJson: { v: 1 } });

    expect(await upsertMintInfo(db, newer)).toBe("inserted");
    expect(await upsertMintInfo(db, older)).toBe("rejected-stale");

    const fetched = await db.mintInfo.get(newer.d);
    expect(fetched?.infoJson).toEqual({ v: 2 });
  });

  it("treats equal fetchedAt as stale (no churn)", async () => {
    const db = await freshDB();
    const a = makeMintInfo({ fetchedAt: 1000, infoJson: { v: "a" } });
    const b = makeMintInfo({ fetchedAt: 1000, infoJson: { v: "b" } });

    expect(await upsertMintInfo(db, a)).toBe("inserted");
    expect(await upsertMintInfo(db, b)).toBe("rejected-stale");

    const fetched = await db.mintInfo.get(a.d);
    expect(fetched?.infoJson).toEqual({ v: "a" });
  });

  it("ok=false overwrites a prior ok=true on a newer fetch — `ok` is NOT part of the CAS predicate", async () => {
    // Design choice: mintInfo CAS is monotonic on fetchedAt only. The
    // freshness signal wins regardless of the success bit so the cache
    // accurately reflects the latest /v1/info attempt — including outages.
    const db = await freshDB();
    const ok = makeMintInfo({
      fetchedAt: 1000,
      ok: true,
      infoJson: { name: "live mint" },
    });
    const failed = makeMintInfo({
      fetchedAt: 2000,
      ok: false,
      infoJson: {},
      lastError: "ECONNREFUSED",
    });

    expect(await upsertMintInfo(db, ok)).toBe("inserted");
    expect(await upsertMintInfo(db, failed)).toBe("replaced");

    const fetched = await db.mintInfo.get(ok.d);
    expect(fetched?.ok).toBe(false);
    expect(fetched?.lastError).toBe("ECONNREFUSED");
    expect(fetched?.fetchedAt).toBe(2000);
  });
});

describe("upsertMintAggregate", () => {
  it("inserts, replaces on newer updatedAt, rejects older", async () => {
    const db = await freshDB();
    const older = makeMintAggregate({ updatedAt: 1000, bayesianScore: 1.0 });
    const newer = makeMintAggregate({ updatedAt: 2000, bayesianScore: 4.5 });
    const ancient = makeMintAggregate({ updatedAt: 500 });

    expect(await upsertMintAggregate(db, older)).toBe("inserted");
    expect(await upsertMintAggregate(db, newer)).toBe("replaced");
    expect(await upsertMintAggregate(db, ancient)).toBe("rejected-stale");

    const fetched = await db.mintAggregate.get(older.d);
    expect(fetched?.bayesianScore).toBe(4.5);
    expect(fetched?.updatedAt).toBe(2000);
  });
});
