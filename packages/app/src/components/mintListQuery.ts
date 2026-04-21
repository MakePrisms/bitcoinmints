/**
 * Pure data-layer query for the mint list surface.
 *
 * Extracted from `MintList.tsx` so the join + synthesis logic can be
 * unit-tested against a fake IndexedDB without mounting React. Keeps
 * `MintList.tsx` a thin render shell.
 *
 * Query contract: announcements-driven, kind 38172 (Cashu) only, left-
 * joined against `mintAggregate` (synthesized zero-aggregate when a
 * matching row is absent) and `mintInfo` (left-join, genuinely optional).
 * Sort: positive-bayesianScore rows DESC first, then zero-score rows by
 * announcement `createdAt` DESC.
 *
 * Why announcements-driven: a prior iteration drove this list from
 * `rankMints(db, 50)` (the `mintAggregate` table). That's aggregate-
 * required — any mint with zero reviews has no aggregate row, so it
 * never surfaced. Real-world capture showed 36 announcements, 0 rendered.
 * Driving from `announcements` and synthesizing absent aggregates gives
 * `verifiedBySignerBinding: false` rows (and zero-review rows) a render
 * path with an "unverified" badge downstream, per the v1 spec.
 */
import type {
  AnnouncementRow,
  BitcoinmintsDB,
  MintAggregateRow,
  MintInfoRow,
} from "@bitcoinmints/core";

export type MintListRow = {
  aggregate: MintAggregateRow;
  announcement: AnnouncementRow;
  info: MintInfoRow | undefined;
};

/**
 * Build a zero-populated aggregate for a mint that has no reviews yet.
 * Matches `recomputeAggregateInTx`'s zero-review output shape (core's
 * reviews/aggregate.ts) so downstream render code can't tell a
 * synthesized row from a materialized-but-empty one. `updatedAt: 0`
 * flags "synthesized placeholder" — any real materialized row uses
 * `Date.now()` which is always >> 0.
 */
export function emptyAggregate(d: string): MintAggregateRow {
  return {
    d,
    reviewCount: 0,
    ratedCount: 0,
    avgRating: null,
    bayesianScore: 0,
    updatedAt: 0,
  };
}

/**
 * Dedupe announcements by `d`, keeping the NIP-01-winning row for each
 * d-tag. Multiple pubkeys CAN claim the same `d`; we pick the highest
 * `createdAt`, tiebreaking on lowest `eventId` per NIP-01 §7.3. The
 * per-(pubkey, d) row remains in the DB — this dedupe is display-only.
 */
function dedupeByD(announcements: AnnouncementRow[]): Map<string, AnnouncementRow> {
  const byD = new Map<string, AnnouncementRow>();
  for (const a of announcements) {
    const existing = byD.get(a.d);
    if (!existing) {
      byD.set(a.d, a);
      continue;
    }
    if (a.createdAt > existing.createdAt) {
      byD.set(a.d, a);
    } else if (a.createdAt === existing.createdAt && a.eventId < existing.eventId) {
      byD.set(a.d, a);
    }
  }
  return byD;
}

/**
 * Execute the mint-list query against Dexie and return joined rows in
 * the render order the UI wants. Async. Safe to call inside Dexie
 * `useLiveQuery`.
 */
export async function queryMintList(db: BitcoinmintsDB): Promise<MintListRow[]> {
  // Cashu-only per spec v1. Pushing the kind gate into the Dexie query
  // (via the `kind` secondary index on announcements) keeps the join
  // cheap and avoids pulling Fedimint rows into memory only to drop
  // them. Fedimints will surface via a separate toggle in a later PR.
  const announcements = await db.announcements.where("kind").equals(38172).toArray();

  if (announcements.length === 0) return [];

  const byD = dedupeByD(announcements);
  const ds = Array.from(byD.keys());
  const aggregates = await db.mintAggregate.bulkGet(ds);
  const infos = await db.mintInfo.bulkGet(ds);

  const joined: MintListRow[] = ds.map((d, i) => {
    const announcement = byD.get(d);
    if (!announcement) {
      // Unreachable — `ds` came from `byD.keys()`. TS doesn't know that.
      throw new Error(`invariant: no announcement for d=${d}`);
    }
    return {
      aggregate: aggregates[i] ?? emptyAggregate(d),
      announcement,
      info: infos[i],
    };
  });

  // Sort: positive bayesianScore first (DESC), then zero-score rows
  // by announcement.createdAt DESC. Inside each partition the sort is
  // stable, so ties preserve insertion order.
  joined.sort((a, b) => {
    const aPositive = a.aggregate.bayesianScore > 0;
    const bPositive = b.aggregate.bayesianScore > 0;
    if (aPositive && bPositive) {
      return b.aggregate.bayesianScore - a.aggregate.bayesianScore;
    }
    if (aPositive !== bPositive) {
      return aPositive ? -1 : 1;
    }
    // Both zero-score: newest announcement first.
    return b.announcement.createdAt - a.announcement.createdAt;
  });

  return joined;
}
