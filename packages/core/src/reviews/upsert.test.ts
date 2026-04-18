/**
 * Integration tests for upsertReviewWithAggregate — exercises the
 * transactional wiring between the review CAS upsert and the aggregate
 * materialization. The invariants we care about:
 *
 *   1. Inserted / replaced reviews → aggregate is recomputed in the same
 *      transaction so a concurrent read never sees a review without its
 *      aggregate reflection.
 *   2. Rejected-stale / rejected-invalid reviews → aggregate is NOT
 *      touched (no spurious updatedAt churn).
 *   3. CAS semantics on (pubkey, d) are preserved: newer createdAt wins,
 *      tiebreak on eventId.
 *   4. Replace-a-review's-rating flows through to the aggregate correctly.
 */
import { afterEach, describe, expect, it } from "vitest";
import { BitcoinmintsDB, type ReviewRow } from "../cache";
import { upsertReviewWithAggregate } from "./upsert";

const freshName = () => `test-review-upsert-${Math.random().toString(36).slice(2)}`;
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

const D_VALID = "5fe928ae0970844f3c5253d2e85a88788486edcbd96c070334a4a2d0d0154a77";
const D_BOT = "psvef0yh2zk24tt7"; // 16-char legacy/bot-spam shape.

const EID_LOW = `${"0".repeat(60)}aaaa`;
const EID_HIGH = `${"0".repeat(60)}ffff`;

function makeReview(over: Partial<ReviewRow> = {}): ReviewRow {
  return {
    pubkey: `pk${"0".repeat(60)}1`,
    kind: 38000,
    d: D_VALID,
    eventId: EID_LOW,
    createdAt: 1_700_000_000,
    content: "",
    rawTags: [],
    rating: 5,
    ...over,
  };
}

describe("upsertReviewWithAggregate — insert + recompute", () => {
  it("first insert populates both reviews and mintAggregate in one transaction", async () => {
    const db = await freshDB();
    const row = makeReview({ rating: 5 });

    const result = await upsertReviewWithAggregate(db, row, () => 1234);
    expect(result).toBe("inserted");

    expect(await db.reviews.count()).toBe(1);
    const agg = await db.mintAggregate.get(D_VALID);
    expect(agg).toBeDefined();
    expect(agg?.reviewCount).toBe(1);
    expect(agg?.ratedCount).toBe(1);
    expect(agg?.avgRating).toBe(5);
    expect(agg?.bayesianScore).toBeCloseTo(5 * Math.log10(2), 6);
    expect(agg?.updatedAt).toBe(1234);
  });

  it("unrated insert still populates aggregate with reviewCount=1, ratedCount=0, avg=null, bayesian=0", async () => {
    const db = await freshDB();
    const row = makeReview({ rating: null });

    const result = await upsertReviewWithAggregate(db, row);
    expect(result).toBe("inserted");

    const agg = await db.mintAggregate.get(D_VALID);
    expect(agg?.reviewCount).toBe(1);
    expect(agg?.ratedCount).toBe(0);
    expect(agg?.avgRating).toBeNull();
    expect(agg?.bayesianScore).toBe(0);
  });

  it("N reviews for same d → aggregate reflects mean across all rated", async () => {
    const db = await freshDB();
    await upsertReviewWithAggregate(db, makeReview({ pubkey: "pk-1", rating: 5 }));
    await upsertReviewWithAggregate(db, makeReview({ pubkey: "pk-2", rating: 3 }));
    await upsertReviewWithAggregate(db, makeReview({ pubkey: "pk-3", rating: 4 }));

    const agg = await db.mintAggregate.get(D_VALID);
    expect(agg?.reviewCount).toBe(3);
    expect(agg?.ratedCount).toBe(3);
    expect(agg?.avgRating).toBe((5 + 3 + 4) / 3);
    expect(agg?.bayesianScore).toBeCloseTo(agg!.avgRating! * Math.log10(4), 6);
  });
});

describe("upsertReviewWithAggregate — CAS + aggregate-stays-in-sync", () => {
  it("replace on newer createdAt → aggregate reflects the NEW rating", async () => {
    const db = await freshDB();
    await upsertReviewWithAggregate(db, makeReview({ createdAt: 1000, rating: 1 }));
    const before = await db.mintAggregate.get(D_VALID);
    expect(before?.avgRating).toBe(1);

    const result = await upsertReviewWithAggregate(db, makeReview({ createdAt: 2000, rating: 5 }));
    expect(result).toBe("replaced");

    const after = await db.mintAggregate.get(D_VALID);
    expect(after?.avgRating).toBe(5);
    expect(after?.reviewCount).toBe(1); // still just the one reviewer
    expect(after?.ratedCount).toBe(1);
  });

  it("reject older → aggregate is NOT rewritten (updatedAt stays put)", async () => {
    const db = await freshDB();
    await upsertReviewWithAggregate(db, makeReview({ createdAt: 2000, rating: 5 }), () => 1000);
    const before = await db.mintAggregate.get(D_VALID);
    expect(before?.updatedAt).toBe(1000);

    const result = await upsertReviewWithAggregate(
      db,
      makeReview({ createdAt: 1000, rating: 1 }),
      () => 9999,
    );
    expect(result).toBe("rejected-stale");

    const after = await db.mintAggregate.get(D_VALID);
    expect(after?.updatedAt).toBe(1000); // not touched
    expect(after?.avgRating).toBe(5);
  });

  it("tiebreak on eventId: same createdAt, lower eventId wins (NIP-01), aggregate reflects new rating", async () => {
    // NIP-01: "In case of replaceable events with the same timestamp, the
    // event with the lowest id (first in lexical order) should be retained."
    const db = await freshDB();
    await upsertReviewWithAggregate(db, makeReview({ eventId: EID_HIGH, rating: 5 }));
    const result = await upsertReviewWithAggregate(db, makeReview({ eventId: EID_LOW, rating: 1 }));
    expect(result).toBe("replaced");

    const agg = await db.mintAggregate.get(D_VALID);
    expect(agg?.avgRating).toBe(1);
  });

  it("tiebreak rejects higher eventId (NIP-01): aggregate NOT updated", async () => {
    const db = await freshDB();
    await upsertReviewWithAggregate(db, makeReview({ eventId: EID_LOW, rating: 1 }), () => 1000);
    const result = await upsertReviewWithAggregate(
      db,
      makeReview({ eventId: EID_HIGH, rating: 5 }),
      () => 9999,
    );
    expect(result).toBe("rejected-stale");

    const agg = await db.mintAggregate.get(D_VALID);
    expect(agg?.updatedAt).toBe(1000);
    expect(agg?.avgRating).toBe(1);
  });

  it("replacing a rated review with an unrated one → aggregate flips to avg=null", async () => {
    const db = await freshDB();
    await upsertReviewWithAggregate(db, makeReview({ createdAt: 1000, rating: 5 }));
    expect((await db.mintAggregate.get(D_VALID))?.avgRating).toBe(5);

    await upsertReviewWithAggregate(db, makeReview({ createdAt: 2000, rating: null }));
    const agg = await db.mintAggregate.get(D_VALID);
    expect(agg?.reviewCount).toBe(1);
    expect(agg?.ratedCount).toBe(0);
    expect(agg?.avgRating).toBeNull();
    expect(agg?.bayesianScore).toBe(0);
  });

  it("replacing one unrated review with a rated one → aggregate picks up the new rating", async () => {
    const db = await freshDB();
    await upsertReviewWithAggregate(db, makeReview({ createdAt: 1000, rating: null }));
    expect((await db.mintAggregate.get(D_VALID))?.avgRating).toBeNull();

    await upsertReviewWithAggregate(db, makeReview({ createdAt: 2000, rating: 4 }));
    const agg = await db.mintAggregate.get(D_VALID);
    expect(agg?.ratedCount).toBe(1);
    expect(agg?.avgRating).toBe(4);
  });
});

describe("upsertReviewWithAggregate — concurrent CAS + aggregate race", () => {
  it("two concurrent upserts for the same d (different pubkeys) converge — aggregate reflects BOTH reviews, 5 trials", async () => {
    // Regression for the race where the review CAS upsert and the aggregate
    // recompute are in the same transaction: if both concurrent upserts
    // read the reviews table before either writes, the recompute would
    // see only one review and the aggregate would drop to reviewCount=1.
    // Dexie serializes rw-rw transactions on the same tables, so the
    // correct outcome is both reviews land AND the aggregate sees both.
    // Mirrors the announcement-side regression in cache/upsert.test.ts (~L288).
    const pkA = `pk-a${"0".repeat(60)}`;
    const pkB = `pk-b${"0".repeat(60)}`;
    const reviewA = makeReview({ pubkey: pkA, eventId: EID_LOW, rating: 5 });
    const reviewB = makeReview({ pubkey: pkB, eventId: EID_HIGH, rating: 1 });

    for (let trial = 0; trial < 5; trial++) {
      const db = await freshDB();
      const ops =
        trial % 2 === 0
          ? [upsertReviewWithAggregate(db, reviewA), upsertReviewWithAggregate(db, reviewB)]
          : [upsertReviewWithAggregate(db, reviewB), upsertReviewWithAggregate(db, reviewA)];
      const results = await Promise.all(ops);

      // Both reviews land — distinct (pubkey, kind, d) triples don't CAS-fail.
      expect(results).toEqual(["inserted", "inserted"]);
      expect(await db.reviews.count()).toBe(2);

      // Aggregate reflects BOTH reviews — this is the invariant that
      // would break if the recompute ran on a pre-write snapshot of
      // the reviews table.
      const agg = await db.mintAggregate.get(D_VALID);
      expect(agg).toBeDefined();
      expect(agg?.reviewCount).toBe(2);
      expect(agg?.ratedCount).toBe(2);
      expect(agg?.avgRating).toBe(3); // (5 + 1) / 2
      expect(agg?.bayesianScore).toBeCloseTo(3 * Math.log10(3), 6);
    }
  });
});

describe("upsertReviewWithAggregate — Layer A gate", () => {
  it("16-char bot-spam d-tag → rejected-invalid, no review row, no aggregate row", async () => {
    const db = await freshDB();
    const result = await upsertReviewWithAggregate(db, makeReview({ d: D_BOT }));
    expect(result).toBe("rejected-invalid");
    expect(await db.reviews.count()).toBe(0);
    expect(await db.mintAggregate.count()).toBe(0);
  });

  it("Fedimint k=38173 review with non-regex d bypasses the gate", async () => {
    const db = await freshDB();
    // A federation ID isn't constrained by the Cashu-mint-pubkey regex.
    const fediRow = makeReview({
      d: "718e421be177486639330d198e870b7345ebd07b2866b5fd3797d73e4bc4c9af",
      k: 38173,
    });
    const result = await upsertReviewWithAggregate(db, fediRow);
    expect(result).toBe("inserted");
    expect(await db.reviews.count()).toBe(1);
  });
});
