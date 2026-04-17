/**
 * Kind:38000 mint-recommendation / review parser.
 *
 * Emits `ReviewRow` directly — this is the primary parse path used by the
 * scheduler's ingest pipeline and by the `reviews/upsert.ts` wrapper. The
 * related `nip87/parseRecommendation` returns `MintRecommendation` (a
 * parse-layer shape with `raw` preserved); this module produces the
 * cache-layer shape with tags indexed for downstream Dexie writes.
 *
 * Rating extraction follows data-model-v1.md §4 + rating-tag-research.md §6
 * in strict precedence order:
 *
 *   1. `["rating", "<N>", "5"]` — canonical v1 shape, integer 1..5.
 *   2. `["rating", "<N>"]` — legacy recall-trainer emitter, integer 1..5.
 *   3. Content numeric: regex "^(N)/5" or "^(N)/10" anchored at start
 *      (see CONTENT_FIVE_REGEX and CONTENT_TEN_REGEX below). For /10 we
 *      divide by 2 and round to the nearest integer 1..5.
 *   4. Content emoji: leading 1..5 run of star glyphs (see
 *      CONTENT_EMOJI_REGEX) — count the glyphs.
 *   5. Otherwise null (no rating present).
 *
 * Rule of precedence: a tag wins over content even if both are present.
 * This keeps v2-aware clients interop-free from cashu.me / bitcoinmints
 * legacy that embed `[N/5]` in content alongside a structured tag.
 *
 * Parse rejects (returns `null`):
 *   - `event.kind !== 38000`
 *   - missing or non-string `d` tag
 *
 * Parse does NOT reject on Layer A d-shape — the upsert gate handles that
 * so the parser stays pure and callable from tests, pagination dedup, etc.
 * Callers who want the Layer A shape firewall use `upsertReviewWithAggregate`.
 */
import type { Event as NostrEvent } from "nostr-tools/core";
import type { ReviewRow } from "../cache";

/** Strict 1..5 integer bounds. Partial reviews (e.g. "3.5") round to nearest int. */
const MIN_RATING = 1;
const MAX_RATING = 5;

/**
 * Content rating: `N/5` anchored at start. Tolerates leading `[` and
 * surrounding whitespace. Captures N.
 */
const CONTENT_FIVE_REGEX = /^\s*\[?\s*(\d+)\s*\/\s*5\b/;
/**
 * Content rating: `N/10` anchored at start — for clients that use a
 * 10-point scale. Divide by 2 to normalize into 1..5.
 */
const CONTENT_TEN_REGEX = /^\s*\[?\s*(\d+)\s*\/\s*10\b/;
/**
 * Leading run of star emoji, 1..5 count. Matches `⭐` (U+2B50) and `🌟`
 * (U+1F31F) interchangeably — some clients render one, some the other,
 * some use the variation-selector form. Captures the whole run so we can
 * count code points (via the `u` flag).
 */
const CONTENT_EMOJI_REGEX = /^\s*((?:⭐|🌟)+)/u;

/** Pull the first value of a named tag (or undefined). */
function firstTagValue(tags: string[][], name: string): string | undefined {
  for (const t of tags) {
    if (t[0] === name && typeof t[1] === "string") return t[1];
  }
  return undefined;
}

/** Collect all values of a named tag. */
function allTagValues(tags: string[][], name: string): string[] {
  const out: string[] = [];
  for (const t of tags) {
    if (t[0] === name && typeof t[1] === "string") out.push(t[1]);
  }
  return out;
}

/** Parse a numeric string to int 1..5, or undefined if out of range. */
function toRating(raw: string): number | undefined {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return undefined;
  if (n < MIN_RATING || n > MAX_RATING) return undefined;
  return n;
}

/**
 * Extract rating from tags. Format 1 (`["rating","N","5"]`) wins over
 * format 2 (`["rating","N"]`) — scan the entire tag list for format 1
 * first, then fall back to format 2. A single event with both shapes
 * (which shouldn't happen, but is technically allowed by the event
 * structure) always prefers the explicit-max form.
 */
function parseRatingFromTags(tags: string[][]): number | undefined {
  // Format 1: ["rating", "<N>", "5"] — canonical v1 shape.
  for (const t of tags) {
    if (t[0] !== "rating") continue;
    if (typeof t[1] !== "string") continue;
    if (t[2] !== "5") continue;
    const r = toRating(t[1]);
    if (r !== undefined) return r;
  }
  // Format 2: ["rating", "<N>"] — legacy, no denominator.
  for (const t of tags) {
    if (t[0] !== "rating") continue;
    if (typeof t[1] !== "string") continue;
    if (t[2] !== undefined) continue;
    const r = toRating(t[1]);
    if (r !== undefined) return r;
  }
  return undefined;
}

/**
 * Count leading star emoji. `⭐` is a single BMP code point (U+2B50); `🌟`
 * is a surrogate pair (U+1F31F). Using `[...]` iterates code points in
 * modern JS so mixed runs count correctly.
 */
function countLeadingStars(match: string): number {
  const codepoints = [...match];
  return codepoints.length;
}

/**
 * Extract rating from content using the 3rd and 4th precedence rules.
 * Format 3 (N/5 and N/10) wins over format 4 (emoji) — a content starting
 * with `[4/5] ⭐⭐⭐⭐⭐` parses as 4, not 5.
 *
 * Precedence is explicit, not emergent: when an N/5 or N/10 prefix matches
 * the content but the parsed number is out of range (e.g. `0/10`, `7/5`),
 * we return `undefined` rather than falling through to the emoji format.
 * The reasoning: the author signalled "this review uses the numeric
 * format" by leading with it — silently reading emoji that might follow
 * would misrepresent their intent and reward malformed input. Out-of-range
 * numeric prefixes collapse to "no rating" via the parseReview `?? null`
 * fallback.
 */
function parseRatingFromContent(content: string): number | undefined {
  // Format 3a: N/5 anchored at start.
  // precedence: this format consumed → return (even when out of range)
  const fiveMatch = content.match(CONTENT_FIVE_REGEX);
  if (fiveMatch?.[1]) {
    const r = toRating(fiveMatch[1]);
    if (r !== undefined) return r;
    return undefined;
  }
  // Format 3b: N/10 anchored at start — divide by 2, round to nearest,
  // clamp into 1..5. We round-to-nearest (not floor) so `5/10` → 3 and
  // `7/10` → 4 rather than both flooring to 3. An `N` outside 0..10 is
  // treated as missing.
  // precedence: this format consumed → return (even when out of range)
  const tenMatch = content.match(CONTENT_TEN_REGEX);
  if (tenMatch?.[1]) {
    const n = Number.parseInt(tenMatch[1], 10);
    if (Number.isFinite(n) && n >= 0 && n <= 10) {
      const scaled = Math.round(n / 2);
      // 0/10 → 0 which is below MIN_RATING; treat as no-rating rather
      // than lying about a 1-star review.
      if (scaled >= MIN_RATING && scaled <= MAX_RATING) return scaled;
    }
    return undefined;
  }
  // Format 4: leading 1..5 emoji run.
  const emojiMatch = content.match(CONTENT_EMOJI_REGEX);
  if (emojiMatch?.[1]) {
    const n = countLeadingStars(emojiMatch[1]);
    if (n >= MIN_RATING && n <= MAX_RATING) return n;
  }
  return undefined;
}

/** Resolve the `k` tag into a recognized pointer-kind, or undefined. */
function parsePointerKind(tags: string[][]): 38172 | 38173 | undefined {
  const kStr = firstTagValue(tags, "k");
  if (kStr === "38172") return 38172;
  if (kStr === "38173") return 38173;
  return undefined;
}

/**
 * Parse a kind:38000 event into a ReviewRow. Returns `null` when the event
 * is the wrong kind or is missing the required `d` tag. Layer A d-tag
 * shape validation is deferred to the upsert layer.
 */
export function parseReview(event: NostrEvent): ReviewRow | null {
  if (event.kind !== 38000) return null;

  const d = firstTagValue(event.tags, "d");
  if (d === undefined || d === "") return null;

  const content = typeof event.content === "string" ? event.content : "";
  const rating = parseRatingFromTags(event.tags) ?? parseRatingFromContent(content) ?? null;

  const row: ReviewRow = {
    pubkey: event.pubkey,
    kind: 38000,
    d,
    eventId: event.id,
    createdAt: event.created_at,
    content,
    rawTags: event.tags,
    rating,
  };

  const k = parsePointerKind(event.tags);
  if (k !== undefined) row.k = k;

  const u = allTagValues(event.tags, "u");
  if (u.length > 0) row.u = u;

  return row;
}
