import type { AnnouncementRow, MintAggregateRow, MintInfoRow } from "@bitcoinmints/core";
import type { JSX } from "react";

/**
 * Two-tier X-ray render of a single mint.
 *
 * Tier 1 — human-readable top matter pulled out of `info.infoJson` (NUT-06):
 *   name, description, version, motd, contact, urls, rating/score/verified.
 *
 * Tier 0 — de-emphasized technical identifiers (d, pubkey, kind) pinned below
 *   the top matter for X-ray debugging; deliberately small + faded, not
 *   user-facing content.
 *
 * Tier 2 — collapsed <details> blocks for the raw mintInfo, announcement, and
 *   aggregate JSON, so the full shape (including rawTags, sig, etc.) stays
 *   inspectable without drowning the first glance.
 *
 * Browser-native <details> disclosure — no dep, no state, no animation.
 */
type Props = {
  aggregate: MintAggregateRow;
  announcement: AnnouncementRow | undefined;
  info: MintInfoRow | undefined;
  /** Final row in the list gets no trailing <hr>. */
  isLast: boolean;
};

/**
 * Render the NUT-06 `contact` field. The spec says it's an array of
 * `{ method, info }` objects, but mints in the wild have been seen emitting
 * the older array-of-tuples shape (`[[method, info], ...]`). Handle both
 * defensively — anything that doesn't match either shape is skipped rather
 * than crashing the row render.
 */
function renderContact(contact: unknown): string[] {
  if (!Array.isArray(contact)) return [];
  const lines: string[] = [];
  for (const entry of contact) {
    if (Array.isArray(entry) && entry.length >= 2) {
      // Legacy tuple shape: ["email", "foo@bar"].
      const [method, value] = entry;
      if (typeof method === "string" && typeof value === "string") {
        lines.push(`contact: ${method} ${value}`);
      }
      continue;
    }
    if (entry && typeof entry === "object") {
      // NUT-06 object shape: { method, info }.
      const obj = entry as Record<string, unknown>;
      const method = obj.method;
      const value = obj.info;
      if (typeof method === "string" && typeof value === "string") {
        lines.push(`contact: ${method} ${value}`);
      }
    }
  }
  return lines;
}

export function MintRow({ aggregate, announcement, info, isLast }: Props): JSX.Element {
  const body = info?.infoJson as Record<string, unknown> | undefined;

  const name = typeof body?.name === "string" && body.name.length > 0 ? body.name : undefined;
  const description = typeof body?.description === "string" ? body.description : undefined;
  const version = typeof body?.version === "string" ? body.version : undefined;
  const motd = typeof body?.motd === "string" ? body.motd : undefined;
  const contactLines = renderContact(body?.contact);

  const urls = announcement?.u ?? [];

  const ratedCount = aggregate.ratedCount;
  const reviewCount = aggregate.reviewCount;
  const avg = aggregate.avgRating;
  const ratingLine =
    avg === null
      ? `rating: — (${reviewCount} total, 0 rated)`
      : `rating: ${avg}/5 (${ratedCount} ratings, ${reviewCount} total)`;

  const verifiedLabel = announcement
    ? announcement.verifiedBySignerBinding === true
      ? "verified"
      : announcement.verifiedBySignerBinding === false
        ? "unverified"
        : "pending"
    : "(no announcement)";

  // Tier 0 identifiers — present even if announcement is missing so the
  // dangling-aggregate state is still visible.
  const pubkey = announcement?.pubkey ?? "(no announcement)";
  const d = aggregate.d;
  const kind = announcement?.kind ?? "(no announcement)";

  return (
    <>
      <div>name: {name ?? "(no name)"}</div>
      {description && <div>description: {description}</div>}
      {urls.map((url) => (
        <div key={url}>url: {url}</div>
      ))}
      <div>{ratingLine}</div>
      <div>score: {aggregate.bayesianScore}</div>
      <div>verified: {verifiedLabel}</div>
      {version && <div>version: {version}</div>}
      {motd && <div>motd: {motd}</div>}
      {contactLines.map((line) => (
        <div key={line}>{line}</div>
      ))}

      <div className="text-xs opacity-60">
        <div>d: {d}</div>
        <div>pubkey: {pubkey}</div>
        <div>kind: {String(kind)}</div>
      </div>

      {info ? (
        <details>
          <summary>raw mintInfo</summary>
          <pre>{JSON.stringify(info, null, 2)}</pre>
        </details>
      ) : (
        <div>mintInfo: (none)</div>
      )}
      {announcement && (
        <details>
          <summary>raw announcement</summary>
          <pre>{JSON.stringify(announcement, null, 2)}</pre>
        </details>
      )}
      <details>
        <summary>raw aggregate</summary>
        <pre>{JSON.stringify(aggregate, null, 2)}</pre>
      </details>

      {!isLast && <hr />}
    </>
  );
}
