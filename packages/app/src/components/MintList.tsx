import type { BitcoinmintsDB } from "@bitcoinmints/core";
import { useLiveQuery } from "dexie-react-hooks";
import type { JSX } from "react";
import { MintRow } from "./MintRow";
import { type MintListRow, queryMintList } from "./mintListQuery";

/**
 * The whole list surface for PR #6 — spec is raw field dump per mint,
 * with `verifiedBySignerBinding === false` rendered as an "unverified"
 * badge (handled downstream in `MintRow`), NOT filtered out.
 *
 * All the query + join logic lives in `mintListQuery.ts` so it can be
 * unit-tested against fake-indexeddb without mounting React. This
 * component is a thin render shell: live-query → map to `<MintRow>`.
 *
 * Prior behavior (for the historians): we called `rankMints(db, 50)` and
 * iterated the aggregates. That approach is aggregate-required — any
 * mint without a review at all had no row to join from, so it was never
 * visible. sharegap.net (0 reviews, Layer B failed) fell into that gap.
 * The capture of 36 announcements → 0 rendered was this bug. See
 * `mintListQuery.ts` for the fix: announcements-driven, with synthesized
 * zero-aggregates for un-reviewed mints.
 */
type Props = {
  db: BitcoinmintsDB;
};

export function MintList({ db }: Props): JSX.Element {
  const rows = useLiveQuery<MintListRow[], MintListRow[]>(() => queryMintList(db), [db], []);

  // Empty state per spec: stats block still renders (that's in App.tsx),
  // the `mints` header always renders, and if there's nothing to show the
  // single line `no mints yet` sits below it.
  if (rows.length === 0) {
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
      {rows.map((row, i) => (
        <MintRow
          key={row.announcement.d}
          aggregate={row.aggregate}
          announcement={row.announcement}
          info={row.info}
          isLast={i === rows.length - 1}
        />
      ))}
    </>
  );
}
