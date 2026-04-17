/**
 * Ranking export — thin helper around the `mintAggregate` Dexie index.
 *
 * `bayesianScore` is materialized on every review upsert (see
 * reviews/aggregate.ts), and the v3 schema declares a secondary index on
 * it, so this query reduces to an index range-scan in reverse + limit —
 * no per-row compute at query time, no full-table sort.
 *
 * Intentionally thin; the `mintAggregate` row is the API surface.
 * Downstream join against `mintInfo`, `announcements`, and
 * `auditLiveness` (when it ships) happens at the render layer — this
 * export is the ranked list of mint `d`s with their aggregates attached.
 */
import type { BitcoinmintsDB, MintAggregateRow } from "../cache";

/**
 * Return the top-N mint aggregates sorted by `bayesianScore` descending.
 * Defaults to 50 per the data-model-v1.md §13 example query; pass
 * `limit: Infinity` (or a high number) for the full ranked list.
 *
 * Ties on `bayesianScore` are broken by Dexie's natural index order on
 * the primary key (the `d`), which is deterministic but not
 * semantically-meaningful. That's acceptable at the edge — a meaningful
 * tiebreak (e.g. by `ratedCount` then by most-recent review) can be
 * layered as a JS sort on the returned array if UX wants it.
 */
export async function rankMints(db: BitcoinmintsDB, limit = 50): Promise<MintAggregateRow[]> {
  return db.mintAggregate.orderBy("bayesianScore").reverse().limit(limit).toArray();
}
