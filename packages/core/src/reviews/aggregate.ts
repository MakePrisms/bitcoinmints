/**
 * `mintAggregate` materialization — derived from all `reviews` rows with a
 * given `d` tag. Runs inside the same Dexie transaction as the triggering
 * review upsert so the two stores can't go out of sync across a crash.
 *
 * See data-model-v1.md §13: we maintain a cached aggregate rather than a
 * live Dexie query because ranking needs a per-filter-change sort and
 * groupby-by-d is expensive in the browser. Recompute is cheap — scoped
 * to a single `d`, per-mint review count is bounded (~500 worst case),
 * entirely in memory once Dexie has surfaced the review rows.
 *
 * Bayesian score (damping formula, §13):
 *
 *   bayesianScore = avgRating * log10(ratedCount + 1)   when avgRating != null
 *   bayesianScore = 0                                   otherwise
 *
 * The damping makes a single 5★ review sort below 4★×10:
 *   single 5★:   5 * log10(2)  ≈ 1.505
 *   4★ × 10:     4 * log10(11) ≈ 4.166
 *
 * Writing out `0` for the un-rated case rather than `null` lets the index
 * on `bayesianScore` be usable as a single `.orderBy('bayesianScore')`
 * range — if we wrote `null`, Dexie would emit those rows at the start of
 * the range under its normal sort order and we'd have to filter them out.
 * Zero-scored mints sort below any positive-scored mint which is the
 * correct UX (and matches the no-reviews baseline).
 */
import type { BitcoinmintsDB, MintAggregateRow, ReviewRow } from "../cache";

/**
 * Compute the Bayesian sort key from an average rating and the count of
 * reviews that contributed to it. Exposed for test assertions.
 */
export function bayesianScore(avgRating: number | null, ratedCount: number): number {
  if (avgRating === null) return 0;
  // log10(0 + 1) = 0 — guard against a degenerate avgRating-with-zero-count
  // (shouldn't happen in practice but clamps to a safe value if it ever does).
  return avgRating * Math.log10(ratedCount + 1);
}

/**
 * Recompute the aggregate for mint `d` from its current `reviews` rows and
 * upsert it. Call INSIDE an open Dexie `rw` transaction that includes both
 * `db.reviews` and `db.mintAggregate` — Dexie auto-binds this work to the
 * outer transaction so a crash between the review write and the aggregate
 * write is impossible.
 *
 * Behaviour on zero reviews: still writes a row with reviewCount=0,
 * ratedCount=0, avgRating=null, bayesianScore=0. This matters for the
 * "review deletion" path — the aggregate doesn't get orphaned with a
 * stale average when the last review for a mint is replaced or removed.
 *
 * CAS policy: uses `put` (unconditional write) rather than the
 * upsert.ts monotonic-timestamp gate. Inside the transaction we already
 * hold the latest review state — the previously-written aggregate is by
 * definition older (or equal in the zero-ops degenerate case, which is
 * still a safe overwrite). Same-ms ties are fine because all row fields
 * are deterministically derived from the review set.
 *
 * `now` is injectable for deterministic tests. Defaults to `Date.now`.
 */
export async function recomputeAggregateInTx(
  db: BitcoinmintsDB,
  d: string,
  now: () => number = Date.now,
): Promise<MintAggregateRow> {
  const reviews: ReviewRow[] = await db.reviews.where("d").equals(d).toArray();

  const reviewCount = reviews.length;
  let ratedCount = 0;
  let sum = 0;
  for (const r of reviews) {
    if (r.rating !== null) {
      ratedCount += 1;
      sum += r.rating;
    }
  }
  const avgRating = ratedCount > 0 ? sum / ratedCount : null;
  const row: MintAggregateRow = {
    d,
    reviewCount,
    ratedCount,
    avgRating,
    bayesianScore: bayesianScore(avgRating, ratedCount),
    updatedAt: now(),
  };

  await db.mintAggregate.put(row);
  return row;
}
