/**
 * Transactional wrapper that composes `cache.upsertReview` with
 * `recomputeAggregateInTx` inside a single Dexie `rw` transaction so the
 * `reviews` table and the `mintAggregate` materialization never drift.
 *
 * The low-level `cache.upsertReview` already opens a transaction on just
 * `db.reviews`. Opening a transaction that includes BOTH `db.reviews` and
 * `db.mintAggregate` at this layer means the nested call inside
 * `cache.upsertReview` is transparently adopted by Dexie's scope
 * inheritance (zone-tracked) — no SubTransactionError. On the accept
 * branches (`inserted` or `replaced`) we recompute; on reject branches
 * (`rejected-stale`, `rejected-invalid`) the DB state didn't change, so
 * the aggregate is already correct — we skip the recompute.
 */
import { type BitcoinmintsDB, type ReviewRow, type UpsertResult, upsertReview } from "../cache";
import { recomputeAggregateInTx } from "./aggregate";

/**
 * Upsert a review and, if the review changed DB state (inserted or
 * replaced), recompute the `mintAggregate` row for that review's `d`.
 * Returns the `UpsertResult` from the underlying review write — this lets
 * callers distinguish "wrote a new row" from "lost the CAS race".
 *
 * `now` is the recompute clock (threaded into `recomputeAggregateInTx`);
 * defaults to `Date.now`.
 */
export async function upsertReviewWithAggregate(
  db: BitcoinmintsDB,
  row: ReviewRow,
  now: () => number = Date.now,
): Promise<UpsertResult> {
  return db.transaction("rw", db.reviews, db.mintAggregate, async () => {
    const result = await upsertReview(db, row);
    if (result === "inserted" || result === "replaced") {
      await recomputeAggregateInTx(db, row.d, now);
    }
    return result;
  });
}
