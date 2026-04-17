import type { AnnouncementRow, MintAggregateRow, MintInfoRow } from "@bitcoinmints/core";
import type { JSX } from "react";

/**
 * Raw per-mint dump — one field per line, monospace, no formatting beyond
 * labels + JSON.stringify. Spec (PR #6 brief) locks every field:
 *
 *   pubkey: ...
 *   d: ...
 *   kind: ...
 *   u: [...]                            // full array JSON, no truncation
 *   createdAt: <epoch seconds>
 *   verifiedBySignerBinding: <true|false|null>
 *   reviewCount: ...                    // 0 if no aggregate row
 *   ratedCount: ...
 *   avgRating: ...
 *   bayesianScore: ...
 *   aggregate.updatedAt: ...
 *   mintInfo: <pretty-printed JSON>     // or `mintInfo: (none)` if no row
 *
 * Rows separated by <hr>.
 */
type Props = {
  aggregate: MintAggregateRow;
  announcement: AnnouncementRow | undefined;
  info: MintInfoRow | undefined;
  /**
   * Final row in the list gets no trailing <hr>. Keeping the decision with
   * the row itself so the parent stays a dumb `.map()`.
   */
  isLast: boolean;
};

export function MintRow({ aggregate, announcement, info, isLast }: Props): JSX.Element {
  // Announcement fields come from the joined row. If the announcement is
  // still undefined the aggregate exists without an announcement — possible
  // when the review lands first and the mint announcement hasn't arrived
  // yet. We render the aggregate fields anyway so the X-ray shows the
  // dangling state rather than hiding it.
  const pubkey = announcement?.pubkey ?? "(no announcement)";
  const d = aggregate.d;
  const kind = announcement?.kind ?? "(no announcement)";
  const u = announcement?.u ?? [];
  const createdAt = announcement?.createdAt ?? "(no announcement)";
  const verifiedBySignerBinding = announcement
    ? String(announcement.verifiedBySignerBinding)
    : "(no announcement)";

  const mintInfoLine = info ? `mintInfo: ${JSON.stringify(info, null, 2)}` : "mintInfo: (none)";

  return (
    <>
      <div>pubkey: {pubkey}</div>
      <div>d: {d}</div>
      <div>kind: {String(kind)}</div>
      <div>u: {JSON.stringify(u)}</div>
      <div>createdAt: {String(createdAt)}</div>
      <div>verifiedBySignerBinding: {verifiedBySignerBinding}</div>
      <div>reviewCount: {aggregate.reviewCount}</div>
      <div>ratedCount: {aggregate.ratedCount}</div>
      <div>avgRating: {String(aggregate.avgRating)}</div>
      <div>bayesianScore: {aggregate.bayesianScore}</div>
      <div>aggregate.updatedAt: {aggregate.updatedAt}</div>
      <pre>{mintInfoLine}</pre>
      {!isLast && <hr />}
    </>
  );
}
