/**
 * Unit tests for the mintAggregate materialization — exercises the
 * bayesian formula directly, then the recompute-from-reviews path.
 */
import { afterEach, describe, expect, it } from "vitest";
import { BitcoinmintsDB, type ReviewRow } from "../cache";
import { bayesianScore, recomputeAggregateInTx } from "./aggregate";

const freshName = () => `test-aggregate-${Math.random().toString(36).slice(2)}`;
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

const D_A = "5fe928ae0970844f3c5253d2e85a88788486edcbd96c070334a4a2d0d0154a77";
const D_B = "0".repeat(63) + "1";

function makeReview(over: Partial<ReviewRow> & { d?: string } = {}): ReviewRow {
  const pubkey = over.pubkey ?? `pk${Math.random().toString(36).slice(2, 10)}${"0".repeat(50)}`;
  const d = over.d ?? D_A;
  const kind = 38000 as const;
  // `k` defaults to Cashu (38172) — tests in this file don't differentiate
  // Cashu vs Fedimint; parse-level `k` handling is covered in parse.test.ts.
  // `a` is derived from kind/pubkey/d per NIP-87's `<kind>:<pubkey>:<d>`.
  const k = over.k ?? 38172;
  return {
    pubkey,
    kind,
    d,
    eventId: `${"0".repeat(58)}${Math.random().toString(36).slice(2, 8)}`,
    createdAt: 1_700_000_000,
    k,
    a: `${kind}:${pubkey}:${d}`,
    content: "",
    rawTags: [],
    rating: 5,
    ...over,
  };
}

/**
 * Directly insert a review row without going through upsertReview's CAS
 * transaction. Used by tests to populate the reviews table so we can
 * exercise recompute in isolation.
 */
async function seedReviews(db: BitcoinmintsDB, rows: ReviewRow[]): Promise<void> {
  await db.reviews.bulkPut(rows);
}

describe("bayesianScore formula", () => {
  it("null avg → 0 (no rated reviews, no sort signal)", () => {
    expect(bayesianScore(null, 0)).toBe(0);
    expect(bayesianScore(null, 5)).toBe(0);
  });

  it("single 5★ review: 5 * log10(2) ≈ 1.505", () => {
    const score = bayesianScore(5, 1);
    expect(score).toBeCloseTo(5 * Math.log10(2), 6);
    expect(score).toBeGreaterThan(1.5);
    expect(score).toBeLessThan(1.51);
  });

  it("10 × 4★ reviews: 4 * log10(11) ≈ 4.166", () => {
    const score = bayesianScore(4, 10);
    expect(score).toBeCloseTo(4 * Math.log10(11), 6);
    expect(score).toBeGreaterThan(4.15);
    expect(score).toBeLessThan(4.17);
  });

  it("damping rule: single 5★ sorts BELOW 10 × 4★ (bayesian dominates)", () => {
    const single5 = bayesianScore(5, 1);
    const tenFour = bayesianScore(4, 10);
    expect(single5).toBeLessThan(tenFour);
  });

  it("edge: log10(1)=0 when ratedCount=0 — even with avg set, degenerate case returns 0", () => {
    // Shouldn't happen in practice, but guard against divide-by-zero glitches.
    expect(bayesianScore(5, 0)).toBe(0);
  });
});

describe("recomputeAggregateInTx — materialization", () => {
  it("0 reviews for d → writes reviewCount=0, ratedCount=0, avgRating=null, bayesianScore=0", async () => {
    const db = await freshDB();
    const row = await db.transaction("rw", db.reviews, db.mintAggregate, async () =>
      recomputeAggregateInTx(db, D_A, () => 12345),
    );
    expect(row.reviewCount).toBe(0);
    expect(row.ratedCount).toBe(0);
    expect(row.avgRating).toBeNull();
    expect(row.bayesianScore).toBe(0);
    expect(row.updatedAt).toBe(12345);

    const persisted = await db.mintAggregate.get(D_A);
    expect(persisted).toEqual(row);
  });

  it("1 rated review → avg = that rating; bayesian = rating * log10(2)", async () => {
    const db = await freshDB();
    await seedReviews(db, [makeReview({ rating: 5, pubkey: "pk-1" })]);
    const row = await db.transaction("rw", db.reviews, db.mintAggregate, async () =>
      recomputeAggregateInTx(db, D_A),
    );
    expect(row.reviewCount).toBe(1);
    expect(row.ratedCount).toBe(1);
    expect(row.avgRating).toBe(5);
    expect(row.bayesianScore).toBeCloseTo(5 * Math.log10(2), 6);
  });

  it("multiple rated reviews: correct mean and count", async () => {
    const db = await freshDB();
    await seedReviews(db, [
      makeReview({ rating: 5, pubkey: "pk-1" }),
      makeReview({ rating: 3, pubkey: "pk-2" }),
      makeReview({ rating: 4, pubkey: "pk-3" }),
      makeReview({ rating: 5, pubkey: "pk-4" }),
    ]);
    const row = await db.transaction("rw", db.reviews, db.mintAggregate, async () =>
      recomputeAggregateInTx(db, D_A),
    );
    expect(row.reviewCount).toBe(4);
    expect(row.ratedCount).toBe(4);
    expect(row.avgRating).toBe((5 + 3 + 4 + 5) / 4);
    expect(row.bayesianScore).toBeCloseTo(row.avgRating! * Math.log10(5), 6);
  });

  it("mixed rated + unrated reviews: reviewCount counts all, ratedCount counts rated, avg only from rated", async () => {
    const db = await freshDB();
    await seedReviews(db, [
      makeReview({ rating: 5, pubkey: "pk-1" }),
      makeReview({ rating: null, pubkey: "pk-2" }),
      makeReview({ rating: 3, pubkey: "pk-3" }),
      makeReview({ rating: null, pubkey: "pk-4" }),
      makeReview({ rating: null, pubkey: "pk-5" }),
    ]);
    const row = await db.transaction("rw", db.reviews, db.mintAggregate, async () =>
      recomputeAggregateInTx(db, D_A),
    );
    expect(row.reviewCount).toBe(5);
    expect(row.ratedCount).toBe(2);
    expect(row.avgRating).toBe((5 + 3) / 2); // 4
    expect(row.bayesianScore).toBeCloseTo(4 * Math.log10(3), 6);
  });

  it("all unrated reviews: avg stays null, bayesian is 0, but reviewCount reflects them", async () => {
    const db = await freshDB();
    await seedReviews(db, [
      makeReview({ rating: null, pubkey: "pk-1" }),
      makeReview({ rating: null, pubkey: "pk-2" }),
    ]);
    const row = await db.transaction("rw", db.reviews, db.mintAggregate, async () =>
      recomputeAggregateInTx(db, D_A),
    );
    expect(row.reviewCount).toBe(2);
    expect(row.ratedCount).toBe(0);
    expect(row.avgRating).toBeNull();
    expect(row.bayesianScore).toBe(0);
  });

  it("scoping: recompute for d=A ignores reviews keyed on d=B", async () => {
    const db = await freshDB();
    await seedReviews(db, [
      makeReview({ rating: 5, pubkey: "pk-1", d: D_A }),
      makeReview({ rating: 1, pubkey: "pk-2", d: D_B }),
      makeReview({ rating: 1, pubkey: "pk-3", d: D_B }),
    ]);
    const rowA = await db.transaction("rw", db.reviews, db.mintAggregate, async () =>
      recomputeAggregateInTx(db, D_A),
    );
    expect(rowA.reviewCount).toBe(1);
    expect(rowA.avgRating).toBe(5);

    const rowB = await db.transaction("rw", db.reviews, db.mintAggregate, async () =>
      recomputeAggregateInTx(db, D_B),
    );
    expect(rowB.reviewCount).toBe(2);
    expect(rowB.avgRating).toBe(1);
  });

  it("idempotency: recomputing twice with no changes produces the same row payload (except updatedAt)", async () => {
    const db = await freshDB();
    await seedReviews(db, [makeReview({ rating: 4, pubkey: "pk-1" })]);
    const first = await db.transaction("rw", db.reviews, db.mintAggregate, async () =>
      recomputeAggregateInTx(db, D_A, () => 1000),
    );
    const second = await db.transaction("rw", db.reviews, db.mintAggregate, async () =>
      recomputeAggregateInTx(db, D_A, () => 2000),
    );
    expect(first.reviewCount).toBe(second.reviewCount);
    expect(first.ratedCount).toBe(second.ratedCount);
    expect(first.avgRating).toBe(second.avgRating);
    expect(first.bayesianScore).toBe(second.bayesianScore);
    expect(second.updatedAt).toBeGreaterThan(first.updatedAt);
  });
});
