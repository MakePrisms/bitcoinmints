/**
 * Regression tests for the mint-list query shape.
 *
 * Captures the design decision that Cashu announcements whose Layer B
 * signer binding failed (`verifiedBySignerBinding: false`) AND Cashu
 * announcements with zero reviews (no `mintAggregate` row) must still
 * appear in the list. The prior aggregate-driven query hid both; the
 * announcements-driven query surfaces them with a synthesized empty
 * aggregate so the renderer can tag them "unverified" or show
 * `reviewCount: 0` as appropriate.
 */
import {
  type AnnouncementRow,
  BitcoinmintsDB,
  upsertAnnouncement,
  upsertMintAggregate,
  upsertReviewWithAggregate,
} from "@bitcoinmints/core";
import { afterEach, describe, expect, it } from "vitest";
import { queryMintList } from "./mintListQuery";

const freshName = () => `test-mint-list-${Math.random().toString(36).slice(2)}`;
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

/** 64-char valid Cashu d-tag deterministically generated from a seed. */
function dForSeed(seed: string): string {
  // Pad/truncate a seed string into a 64-char lowercase hex shape.
  let hex = "";
  for (const ch of seed) {
    hex += ch.charCodeAt(0).toString(16).padStart(2, "0");
  }
  return hex.slice(0, 64).padEnd(64, "0");
}

function makeCashuAnnouncement(over: Partial<AnnouncementRow> & { d: string }): AnnouncementRow {
  return {
    pubkey: `pk${over.d.slice(0, 62)}`,
    kind: 38172,
    eventId: `ev${over.d.slice(0, 62)}`,
    createdAt: 1_700_000_000,
    u: ["https://mint.example"],
    content: "",
    rawTags: [],
    verifiedBySignerBinding: null,
    ...over,
  };
}

describe("queryMintList — Layer B failures render (sharegap regression)", () => {
  it("renders a Cashu announcement whose verifiedBySignerBinding is false", async () => {
    const db = await freshDB();
    const d = dForSeed("sharegap-like-1");
    await upsertAnnouncement(db, makeCashuAnnouncement({ d, verifiedBySignerBinding: false }));
    const rows = await queryMintList(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.announcement.d).toBe(d);
    expect(rows[0]?.announcement.verifiedBySignerBinding).toBe(false);
  });

  it("also renders verifiedBySignerBinding === null (pending) rows", async () => {
    const db = await freshDB();
    const d = dForSeed("pending-layer-b");
    await upsertAnnouncement(db, makeCashuAnnouncement({ d, verifiedBySignerBinding: null }));
    const rows = await queryMintList(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.announcement.verifiedBySignerBinding).toBeNull();
  });
});

describe("queryMintList — mints with no reviews render with a synthesized aggregate", () => {
  it("Cashu announcement with no matching mintAggregate row still appears", async () => {
    const db = await freshDB();
    const d = dForSeed("no-reviews-yet");
    await upsertAnnouncement(db, makeCashuAnnouncement({ d }));
    // Sanity: no aggregate was written.
    expect(await db.mintAggregate.get(d)).toBeUndefined();

    const rows = await queryMintList(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.aggregate).toMatchObject({
      d,
      reviewCount: 0,
      ratedCount: 0,
      avgRating: null,
      bayesianScore: 0,
    });
  });

  it("uses the materialized aggregate when one exists (prefers real data)", async () => {
    const db = await freshDB();
    const d = dForSeed("has-reviews");
    await upsertAnnouncement(db, makeCashuAnnouncement({ d }));
    await upsertReviewWithAggregate(db, {
      pubkey: "pk".padEnd(64, "0"),
      kind: 38000,
      d,
      eventId: "ev".padEnd(64, "0"),
      createdAt: 1_700_000_100,
      k: 38172,
      a: `38172:deadbeef:${d}`,
      rating: 5,
      content: "",
      rawTags: [],
    });

    const rows = await queryMintList(db);
    expect(rows).toHaveLength(1);
    // Not the synthesized zero — real aggregate from the review.
    expect(rows[0]?.aggregate.reviewCount).toBe(1);
    expect(rows[0]?.aggregate.ratedCount).toBe(1);
    expect(rows[0]?.aggregate.avgRating).toBe(5);
    expect(rows[0]?.aggregate.bayesianScore).toBeGreaterThan(0);
  });
});

describe("queryMintList — Cashu-only filter (spec v1)", () => {
  it("Fedimint announcements (kind 38173) are excluded", async () => {
    const db = await freshDB();
    const cashuD = dForSeed("cashu-one");
    // Valid Fedimint d is 64-char lowercase hex, same shape as Cashu hex.
    const fediD = dForSeed("fedi-one");
    await upsertAnnouncement(db, makeCashuAnnouncement({ d: cashuD }));
    await upsertAnnouncement(db, {
      pubkey: `pk${fediD.slice(0, 62)}`,
      kind: 38173,
      d: fediD,
      eventId: `ev${fediD.slice(0, 62)}`,
      createdAt: 1_700_000_000,
      u: ["fed11invite"],
      content: "",
      rawTags: [],
      verifiedBySignerBinding: null,
    });

    const rows = await queryMintList(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.announcement.d).toBe(cashuD);
    expect(rows[0]?.announcement.kind).toBe(38172);
  });
});

describe("queryMintList — sort order", () => {
  it("positive-bayesianScore rows sort before zero-score rows", async () => {
    const db = await freshDB();
    const dReviewed = dForSeed("reviewed-mint");
    const dUnreviewed = dForSeed("unreviewed-mint");
    await upsertAnnouncement(db, makeCashuAnnouncement({ d: dReviewed }));
    await upsertAnnouncement(db, makeCashuAnnouncement({ d: dUnreviewed }));
    // Materialize an aggregate for the first so it has bayesianScore > 0.
    await upsertReviewWithAggregate(db, {
      pubkey: "pk".padEnd(64, "0"),
      kind: 38000,
      d: dReviewed,
      eventId: "ev".padEnd(64, "0"),
      createdAt: 1_700_000_100,
      k: 38172,
      a: `38172:deadbeef:${dReviewed}`,
      rating: 5,
      content: "",
      rawTags: [],
    });

    const rows = await queryMintList(db);
    expect(rows.map((r) => r.announcement.d)).toEqual([dReviewed, dUnreviewed]);
  });

  it("zero-score rows are ordered by announcement.createdAt DESC", async () => {
    const db = await freshDB();
    const dOld = dForSeed("old-mint");
    const dNew = dForSeed("new-mint");
    await upsertAnnouncement(db, makeCashuAnnouncement({ d: dOld, createdAt: 1_000 }));
    await upsertAnnouncement(db, makeCashuAnnouncement({ d: dNew, createdAt: 2_000 }));

    const rows = await queryMintList(db);
    expect(rows.map((r) => r.announcement.d)).toEqual([dNew, dOld]);
  });

  it("positive scores sort DESC among themselves", async () => {
    const db = await freshDB();
    const dHigh = dForSeed("high-score-d");
    const dLow = dForSeed("low-score-d");
    await upsertAnnouncement(db, makeCashuAnnouncement({ d: dHigh }));
    await upsertAnnouncement(db, makeCashuAnnouncement({ d: dLow }));
    // High: synthesize an aggregate with a bigger score directly to
    // bypass the review-upsert arithmetic and keep the test focused on
    // the sort, not the Bayesian math.
    await upsertMintAggregate(db, {
      d: dHigh,
      reviewCount: 10,
      ratedCount: 10,
      avgRating: 5,
      bayesianScore: 5,
      updatedAt: 1,
    });
    await upsertMintAggregate(db, {
      d: dLow,
      reviewCount: 1,
      ratedCount: 1,
      avgRating: 5,
      bayesianScore: 1,
      updatedAt: 1,
    });

    const rows = await queryMintList(db);
    expect(rows.map((r) => r.announcement.d)).toEqual([dHigh, dLow]);
  });
});

describe("queryMintList — empty state", () => {
  it("empty DB returns an empty array", async () => {
    const db = await freshDB();
    expect(await queryMintList(db)).toEqual([]);
  });

  it("DB with only Fedimint announcements returns an empty array", async () => {
    const db = await freshDB();
    const fediD = dForSeed("fedi-only");
    await upsertAnnouncement(db, {
      pubkey: `pk${fediD.slice(0, 62)}`,
      kind: 38173,
      d: fediD,
      eventId: `ev${fediD.slice(0, 62)}`,
      createdAt: 1_700_000_000,
      u: ["fed11invite"],
      content: "",
      rawTags: [],
      verifiedBySignerBinding: null,
    });
    expect(await queryMintList(db)).toEqual([]);
  });
});

describe("queryMintList — duplicate-d dedup", () => {
  it("multiple pubkeys claiming the same d collapse to one row", async () => {
    const db = await freshDB();
    const d = dForSeed("shared-d-tag");
    await upsertAnnouncement(db, {
      pubkey: "pka".padEnd(64, "a"),
      kind: 38172,
      d,
      eventId: "eva".padEnd(64, "a"),
      createdAt: 1_000,
      u: ["https://old.example"],
      content: "",
      rawTags: [],
      verifiedBySignerBinding: null,
    });
    await upsertAnnouncement(db, {
      pubkey: "pkb".padEnd(64, "b"),
      kind: 38172,
      d,
      eventId: "evb".padEnd(64, "b"),
      createdAt: 2_000,
      u: ["https://new.example"],
      content: "",
      rawTags: [],
      verifiedBySignerBinding: null,
    });

    const rows = await queryMintList(db);
    expect(rows).toHaveLength(1);
    // Winner: the higher createdAt row.
    expect(rows[0]?.announcement.createdAt).toBe(2_000);
  });
});
