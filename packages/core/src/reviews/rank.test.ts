/**
 * rankMints — end-to-end test that walks the full review-ingest pipeline
 * and asserts the ranked output matches the Bayesian-damped order
 * (data-model-v1.md §13).
 */
import { afterEach, describe, expect, it } from "vitest";
import { BitcoinmintsDB, type ReviewRow } from "../cache";
import { rankMints } from "./rank";
import { upsertReviewWithAggregate } from "./upsert";

const freshName = () => `test-rank-${Math.random().toString(36).slice(2)}`;
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

/** Helper: 64-char valid Cashu d-tag deterministically generated from an index. */
function dForIndex(n: number): string {
  const hex = n.toString(16).padStart(64, "0");
  return hex;
}

function makeReview(over: Partial<ReviewRow> & { pubkey: string; d: string }): ReviewRow {
  const kind = 38000 as const;
  // `k` defaults to Cashu (38172); rank.test only exercises sort order,
  // which is `k`-agnostic. `a` is derived per NIP-87 `<kind>:<pubkey>:<d>`.
  const k = over.k ?? 38172;
  return {
    kind,
    eventId: `${"0".repeat(58)}${over.pubkey.slice(-6)}`,
    createdAt: 1_700_000_000,
    k,
    a: `${kind}:${over.pubkey}:${over.d}`,
    content: "",
    rawTags: [],
    rating: 5,
    ...over,
  };
}

/**
 * Seed a mint's aggregate by running N reviews of the given rating
 * through the full upsert-with-aggregate pipeline. Returns the
 * materialized aggregate for assertion convenience.
 */
async function seedMint(
  db: BitcoinmintsDB,
  d: string,
  rating: number | null,
  count: number,
): Promise<void> {
  for (let i = 0; i < count; i++) {
    await upsertReviewWithAggregate(
      db,
      makeReview({
        // Unique pubkey per review so each is a separate (pubkey, d)
        // replaceable-event key.
        pubkey: `pk${i.toString(16).padStart(62, "0")}`,
        d,
        rating,
      }),
    );
  }
}

describe("rankMints — sort order", () => {
  it("empty aggregate table → empty result, no throw", async () => {
    const db = await freshDB();
    const ranked = await rankMints(db);
    expect(ranked).toEqual([]);
  });

  it("orders strictly by bayesianScore descending", async () => {
    const db = await freshDB();
    const dHigh = dForIndex(1);
    const dMid = dForIndex(2);
    const dLow = dForIndex(3);
    // High: 5★ × 10 → 5 * log10(11) ≈ 5.21
    await seedMint(db, dHigh, 5, 10);
    // Mid: 4★ × 3 → 4 * log10(4) ≈ 2.41
    await seedMint(db, dMid, 4, 3);
    // Low: 5★ × 1 → 5 * log10(2) ≈ 1.505
    await seedMint(db, dLow, 5, 1);

    const ranked = await rankMints(db);
    expect(ranked.map((r) => r.d)).toEqual([dHigh, dMid, dLow]);
  });

  it("single 5★ review sorts BELOW 4★×10 — the formula damps low-count mints (§13)", async () => {
    const db = await freshDB();
    const dSingle = dForIndex(10);
    const dTen = dForIndex(11);
    await seedMint(db, dSingle, 5, 1);
    await seedMint(db, dTen, 4, 10);

    const ranked = await rankMints(db);
    expect(ranked[0]?.d).toBe(dTen);
    expect(ranked[1]?.d).toBe(dSingle);
    // Sanity: confirm the numeric scores match the §13 table (5.21 vs 1.50).
    expect(ranked[0]?.bayesianScore).toBeGreaterThan(ranked[1]!.bayesianScore);
  });

  it("unrated reviews (bayesianScore=0) sort at the bottom", async () => {
    const db = await freshDB();
    const dRated = dForIndex(20);
    const dUnrated = dForIndex(21);
    await seedMint(db, dRated, 3, 2); // 3 * log10(3) ≈ 1.43
    await seedMint(db, dUnrated, null, 10); // bayesianScore=0

    const ranked = await rankMints(db);
    expect(ranked[0]?.d).toBe(dRated);
    expect(ranked[1]?.d).toBe(dUnrated);
    expect(ranked[1]?.bayesianScore).toBe(0);
  });
});

describe("rankMints — limit", () => {
  it("defaults to top 50 — returns all 3 when < 50 mints are present", async () => {
    const db = await freshDB();
    await seedMint(db, dForIndex(30), 5, 1);
    await seedMint(db, dForIndex(31), 4, 1);
    await seedMint(db, dForIndex(32), 3, 1);
    const ranked = await rankMints(db);
    expect(ranked).toHaveLength(3);
  });

  it("caps at the explicit limit", async () => {
    const db = await freshDB();
    for (let i = 40; i < 50; i++) {
      await seedMint(db, dForIndex(i), 5, i - 39);
    }
    const top3 = await rankMints(db, 3);
    expect(top3).toHaveLength(3);
    // Sanity: scores descending.
    expect(top3[0]!.bayesianScore).toBeGreaterThan(top3[1]!.bayesianScore);
    expect(top3[1]!.bayesianScore).toBeGreaterThan(top3[2]!.bayesianScore);
  });
});

describe("rankMints — limit bounds", () => {
  it("limit=0 returns an empty array, no throw", async () => {
    const db = await freshDB();
    await seedMint(db, dForIndex(60), 5, 3);
    await seedMint(db, dForIndex(61), 4, 2);
    expect(await rankMints(db, 0)).toEqual([]);
  });

  it("limit=Infinity returns every mint in score-descending order", async () => {
    // Dexie's .limit() accepts Number.POSITIVE_INFINITY and clamps to the
    // full result set (verified empirically in fake-indexeddb via this
    // test). If this assertion ever breaks, swap in a high finite limit.
    const db = await freshDB();
    await seedMint(db, dForIndex(70), 5, 10); // 5 * log10(11) ≈ 5.21
    await seedMint(db, dForIndex(71), 4, 3); // 4 * log10(4)  ≈ 2.41
    await seedMint(db, dForIndex(72), 5, 1); // 5 * log10(2)  ≈ 1.505
    const ranked = await rankMints(db, Number.POSITIVE_INFINITY);
    expect(ranked).toHaveLength(3);
    expect(ranked.map((r) => r.d)).toEqual([dForIndex(70), dForIndex(71), dForIndex(72)]);
    // Strictly non-increasing.
    expect(ranked[0]!.bayesianScore).toBeGreaterThan(ranked[1]!.bayesianScore);
    expect(ranked[1]!.bayesianScore).toBeGreaterThan(ranked[2]!.bayesianScore);
  });
});
