/**
 * Layer B — NUT-06 signer-binding verification for kind:38172 announcements.
 *
 * Layer A (nip87/dtag.ts) gates on d-tag shape: cheap, syntactic, runs at
 * cache write time. Layer B is the semantic check the NIP-87 spec leaves
 * on the floor — confirming that the event signer corresponds to the live
 * mint's NUT-06 pubkey. See audit/DIGEST.md §"Top 5 findings" #2 + the
 * signer-binding gap discussed throughout audit/nip87-spec.md.
 *
 * Algorithm:
 *
 *   1. Iterate every URL in `announcement.u` (NIP-87 lets a Cashu mint be
 *      announced under multiple URLs — load-balanced regional endpoints,
 *      v1/v2 paths, etc.).
 *   2. Fetch /v1/info via the supplied fetcher (which is responsible for
 *      its own caching/concurrency/dedup — Layer B treats it as a black
 *      box).
 *   3. If at least one URL returns ok:true AND its `info.pubkey` matches
 *      the announcement signer's pubkey (lowercase compare per
 *      nip87/dtag.ts hex discipline), the binding verifies. The first
 *      match wins — we don't keep poking the others.
 *   4. Otherwise: failure with a structured reason string for diagnostics.
 *
 * Out of scope:
 *   - kind:38173 Fedimint announcements. Federation IDs aren't HTTP pubkeys
 *     and Fedimint has no /v1/info equivalent reachable from the directory
 *     (`fmo.sirion.io` is an external indexer dep we explicitly avoid in
 *     v1 — see audit/data-model-v1.md §3 + DIGEST.md §"Open secondary
 *     questions"). A 38173 row passed in returns reason: "non-cashu" and
 *     verified: false, but should never reach this function in practice.
 *   - Cross-checking the URL itself against the mint's claimed `urls[]`
 *     field. If the mint says it's at A but answers /v1/info at B, that's
 *     a separate flag (data-model §15 case D variant). Out of scope for
 *     this PR.
 *
 * The fetcher contract: a function `(url) => Promise<MintInfoResult>`. The
 * caller passes a fetcher built with `createMintInfoFetcher({...})` so
 * that downstream callers (scheduler, on-demand UI refresh) share one
 * cache + concurrency budget. Layer B does NOT construct its own.
 */
import type { AnnouncementRow } from "../cache";
import type { MintInfoFetcher, MintInfoResult, MintInfoV1 } from "./info";

/**
 * Outcome of a Layer B verification pass.
 *
 * `verified: true` requires at least one /v1/info ok-fetch with a
 * pubkey-match. `info` is populated with the matching mint's response on
 * success — the scheduler upserts this into `MintInfoRow` to avoid a
 * second round-trip. `url` records WHICH URL in `announcement.u` actually
 * verified (the scheduler stores this so a multi-URL mint's MintInfoRow
 * points at the canonical URL that responded with the matching pubkey,
 * not just `u[0]`).
 *
 * On failure, `reason` distinguishes:
 *   - "non-cashu"            — input was kind:38173 (Fedimint), Layer B
 *                              doesn't apply.
 *   - "no-urls"              — announcement had an empty `u` array.
 *   - "all-fetches-failed"   — every URL in `u` returned ok:false. Treated
 *                              as a transient class by the scheduler:
 *                              `verifiedBySignerBinding` stays null so
 *                              the row is re-tried later.
 *   - "pubkey-mismatch: ..." — at least one URL responded ok:true but no
 *                              fetched pubkey matched the signer. The
 *                              suffix lists the actual mismatched pubkey(s)
 *                              for diagnostics. Includes the announcement
 *                              pubkey in the rendered string so the
 *                              consumer doesn't have to re-attach context.
 *                              Treated as a real verdict (false, not null).
 */
export type LayerBResult =
  | { verified: true; url: string; info: MintInfoV1 }
  | {
      verified: false;
      reason: "non-cashu" | "no-urls" | "all-fetches-failed" | string;
    };

const NON_CASHU: LayerBResult = { verified: false, reason: "non-cashu" };

/**
 * Verify the signer-binding for a single announcement against the live
 * mint(s) it claims to represent.
 *
 * Pure function w.r.t. fetcher: every external interaction is funneled
 * through the supplied `fetcher`. No retry, no backoff, no caching here —
 * the fetcher (createMintInfoFetcher) handles all of that.
 */
export async function verifySignerBinding(
  announcement: AnnouncementRow,
  fetcher: MintInfoFetcher,
): Promise<LayerBResult> {
  if (announcement.kind !== 38172) return NON_CASHU;

  const urls = announcement.u;
  if (!urls || urls.length === 0) {
    return { verified: false, reason: "no-urls" };
  }

  const announcementPubkey = announcement.pubkey.toLowerCase();
  const fetched: Array<{ url: string; result: MintInfoResult }> = [];

  for (const url of urls) {
    const result = await fetcher(url);
    fetched.push({ url, result });
    if (result.ok && result.info.pubkey.toLowerCase() === announcementPubkey) {
      // Record WHICH url verified so the scheduler can write the canonical
      // URL into MintInfoRow rather than guessing `u[0]`.
      return { verified: true, url, info: result.info };
    }
  }

  // Drop into one of two failure cases. If every fetch was !ok we report
  // "all-fetches-failed"; if at least one was ok but no pubkey matched we
  // report the mismatch with the actual pubkey(s) for the operator log.
  const okFetches = fetched.filter((f) => f.result.ok);
  if (okFetches.length === 0) {
    return { verified: false, reason: "all-fetches-failed" };
  }

  const seenPubkeys = okFetches
    .map((f) => (f.result.ok ? f.result.info.pubkey : ""))
    .filter((p) => p.length > 0);
  const mismatchSummary = seenPubkeys.length === 1 ? seenPubkeys[0] : `[${seenPubkeys.join(", ")}]`;
  return {
    verified: false,
    reason: `pubkey-mismatch: announcement=${announcementPubkey} mint=${mismatchSummary}`,
  };
}
