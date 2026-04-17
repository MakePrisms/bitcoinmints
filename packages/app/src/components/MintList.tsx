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
 * sorted by `bayesianScore` DESC via `rankMints(db, 50)`. We pair each
 * aggregate with its announcement row via a `useLiveQuery` per row (see
 * MintRow); the join stays naive per the brief ("keep the join naive — a
 * per-row useLiveQuery for mintInfo is fine for v1").
 */
type Props = {
  db: BitcoinmintsDB;
};

export function MintList({ db }: Props): JSX.Element {
  // Order: rankMints() returns aggregates sorted by bayesianScore DESC.
  // A mint with no reviews yet has no aggregate row, so this list can
  // lag behind `announcements` — that's intentional. PR #7 will decide
  // whether to render un-reviewed announcements as a tail section; for
  // the X-ray we follow the ranked-aggregate-as-truth posture.
  const aggregates = useLiveQuery<MintAggregateRow[], MintAggregateRow[]>(
    () => rankMints(db, 50),
    [db],
    [],
  );

  // Empty state per spec: stats block still renders (that's in App.tsx),
  // the `mints` header always renders, and if there's nothing to show the
  // single line `no mints yet` sits below it.
  if (aggregates.length === 0) {
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
      {aggregates.map((agg, i) => (
        <MintRowWithLookup
          key={agg.d}
          db={db}
          aggregate={agg}
          isLast={i === aggregates.length - 1}
        />
      ))}
    </>
  );
}

/**
 * Thin wrapper that joins aggregate → announcement → mintInfo via the
 * live-query hook. Announcement is queried by `d` (first match wins;
 * NIP-01 replaceable semantics mean there's only one current row per
 * [pubkey, kind, d], but a single d-tag CAN appear for multiple pubkeys
 * in-the-wild — PR #7 will surface that ambiguity properly, for now we
 * render whichever comes out of the index).
 */
function MintRowWithLookup({
  db,
  aggregate,
  isLast,
}: {
  db: BitcoinmintsDB;
  aggregate: MintAggregateRow;
  isLast: boolean;
}): JSX.Element {
  const announcement = useLiveQuery<AnnouncementRow | undefined>(
    () => db.announcements.where("d").equals(aggregate.d).first(),
    [db, aggregate.d],
  );
  const info = useLiveQuery<MintInfoRow | undefined>(
    () => db.mintInfo.get(aggregate.d),
    [db, aggregate.d],
  );

  return <MintRow aggregate={aggregate} announcement={announcement} info={info} isLast={isLast} />;
}
