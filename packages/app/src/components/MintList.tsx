import {
  type AnnouncementRow,
  type BitcoinmintsDB,
  type MintAggregateRow,
  type MintInfoRow,
  rankMints,
} from "@bitcoinmints/core";
import { useLiveQuery } from "dexie-react-hooks";
import type { JSX } from "react";
import { MintRow } from "./MintRow";

/**
 * The whole list surface for PR #6 — spec is raw field dump per mint,
 * sorted by `bayesianScore` DESC via `rankMints(db, 50)`.
 *
 * Join strategy: one unified `useLiveQuery` at this level pre-joins
 * aggregate → announcement → mintInfo and hands `<MintRow>` fully-resolved
 * props. Previously we had a per-row `useLiveQuery` which resolved a
 * microtask after the aggregate query, causing a ~1s "(no announcement)"
 * placeholder flash on reload. Single query kills the flash.
 */
type Props = {
  db: BitcoinmintsDB;
};

type JoinedRow = {
  aggregate: MintAggregateRow;
  announcement: AnnouncementRow | undefined;
  info: MintInfoRow | undefined;
};

export function MintList({ db }: Props): JSX.Element {
  // Order: rankMints() returns aggregates sorted by bayesianScore DESC.
  // A mint with no reviews yet has no aggregate row, so this list can
  // lag behind `announcements` — that's intentional. PR #7 will decide
  // whether to render un-reviewed announcements as a tail section; for
  // the X-ray we follow the ranked-aggregate-as-truth posture.
  //
  // Render-filter note: we drop non-Cashu announcements (kind !== 38172)
  // below so the X-ray matches spec v1 (Cashu-only). The parse layer still
  // stores k=38173 (Fedimint) rows and `rankMints` still ranks them — PR
  // #7+ may surface those elsewhere. Keep this filter in the UI; do NOT
  // push it into `rankMints` (don't mutate core for a UI-only concern).
  const rows = useLiveQuery<JoinedRow[], JoinedRow[]>(
    async () => {
      const aggregates = await rankMints(db, 50);
      const ds = aggregates.map((a) => a.d);
      const announcements = await db.announcements.where("d").anyOf(ds).toArray();
      const infos = await db.mintInfo.bulkGet(ds);
      // A single `d` CAN map to multiple announcements (different pubkeys).
      // Map.set keeps whichever appears LAST in `toArray()`; that matches
      // the previous per-row `.first()` behavior only by luck-of-insert-order.
      // PR #7 will resolve the ambiguity properly.
      const annByD = new Map(announcements.map((a) => [a.d, a]));
      // bulkGet returns an array in the same order as the keys; index align.
      return aggregates.map((agg, i) => ({
        aggregate: agg,
        announcement: annByD.get(agg.d),
        info: infos[i],
      }));
    },
    [db],
    [],
  );

  // Render-only Cashu filter (see note above). Orphan aggregates (no
  // announcement — shouldn't happen in practice) are also dropped
  // defensively so we never flash a "(no announcement)" row.
  const visible = rows.filter((r) => r.announcement !== undefined && r.announcement.kind === 38172);

  // Empty state per spec: stats block still renders (that's in App.tsx),
  // the `mints` header always renders, and if there's nothing to show the
  // single line `no mints yet` sits below it.
  if (visible.length === 0) {
    return (
      <>
        <div>mints</div>
        <div>no mints yet</div>
      </>
    );
  }

  return (
    <>
      <div>mints</div>
      {visible.map((row, i) => (
        <MintRow
          key={row.aggregate.d}
          aggregate={row.aggregate}
          announcement={row.announcement}
          info={row.info}
          isLast={i === visible.length - 1}
        />
      ))}
    </>
  );
}
