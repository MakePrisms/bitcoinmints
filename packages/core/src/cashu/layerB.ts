/**
 * Layer B — NUT-06 signer-binding verification for kind:38172 announcements.
 *
 * Layer A (nip87/dtag.ts) gates on d-tag shape: cheap, syntactic, runs at
 * cache write time. Layer B is the semantic check the NIP-87 spec leaves
 * on the floor — confirming that the event signer (`event.pubkey`)
 * corresponds to one of the mint operator's declared identities at
 * `/v1/info`.
 *
 * P0.1 (audit/nip87-conformance-v1.md): the signer is matched against
 * EITHER `/v1/info.pubkey` OR an entry in `/v1/info.contact` whose
 * `method === "nostr"`. NUT-06 lets a mint declare its nostr identity via
 * `contact[?method=nostr].info` (hex pubkey OR npub bech32), and
 * spec-conforming kind:38172 events frequently use that identity as the
 * event signer rather than reusing the mint's secp256k1 pubkey. Both
 * sources count as positive evidence; we widen the allowed set without
 * weakening the check (a mismatch against BOTH sources is still a
 * `verified:false` verdict).
 *
 * Algorithm:
 *
 *   1. Iterate every URL in `announcement.u` (NIP-87 lets a Cashu mint be
 *      announced under multiple URLs — load-balanced regional endpoints,
 *      v1/v2 paths, etc.).
 *   2. Fetch /v1/info via the supplied fetcher (which is responsible for
 *      its own caching/concurrency/dedup — Layer B treats it as a black
 *      box).
 *   3. If at least one URL returns ok:true AND its `info.pubkey` OR any
 *      `info.contact[?method=nostr]` entry (npub-decoded to hex if
 *      necessary) matches the event signer's pubkey (lowercase compare),
 *      the binding verifies. The first match wins.
 *   4. If at least one URL responded ok:true but neither pubkey nor
 *      contact-nostr matched on any of them, return a structured
 *      pubkey-mismatch failure for diagnostics.
 *   5. If at least one ok response had NO usable signer source at all
 *      (no `pubkey`, no `contact.[method=nostr]`), return
 *      `no-signer-source` so the scheduler can persist `null` (genuinely
 *      unverifiable) rather than `false` (mismatch).
 *   6. Otherwise: failure with a structured reason string for diagnostics.
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
import { nip19 } from "nostr-tools";
import type { AnnouncementRow } from "../cache";
import type { MintInfoFetcher, MintInfoResult, MintInfoV1 } from "./info";

/**
 * Outcome of a Layer B verification pass.
 *
 * `verified: true` requires at least one /v1/info ok-fetch with a
 * signer-source match (info.pubkey OR info.contact.[method=nostr]).
 * `info` is populated with the matching mint's response on success — the
 * scheduler upserts this into `MintInfoRow` to avoid a second round-trip.
 * `url` records WHICH URL in `announcement.u` actually verified.
 *
 * On failure, `reason` distinguishes:
 *   - "non-cashu"            — input was kind:38173 (Fedimint), Layer B
 *                              doesn't apply.
 *   - "no-urls"              — announcement had an empty `u` array.
 *   - "all-fetches-failed"   — every URL in `u` returned ok:false. Treated
 *                              as a transient class by the scheduler:
 *                              `verifiedBySignerBinding` stays null so
 *                              the row is re-tried later.
 *   - "no-signer-source"     — at least one URL responded ok:true but
 *                              none had usable signer evidence (no
 *                              `pubkey` AND no `contact.[method=nostr]`).
 *                              Treated as transient by the scheduler so
 *                              the row stays `null` (genuinely cannot
 *                              verify) rather than `false` (mismatch).
 *   - "pubkey-mismatch: ..." — at least one URL responded ok:true with
 *                              usable signer evidence but no source
 *                              matched the event signer. The suffix
 *                              lists the candidate signer sources we
 *                              tried for diagnostics. Treated as a real
 *                              verdict (false, not null).
 */
export type LayerBResult =
  | { verified: true; url: string; info: MintInfoV1 }
  | {
      verified: false;
      reason: "non-cashu" | "no-urls" | "all-fetches-failed" | "no-signer-source" | string;
    };

const NON_CASHU: LayerBResult = { verified: false, reason: "non-cashu" };

/**
 * Decode a possibly-bech32 nostr identifier into lowercase hex.
 *
 * Hex inputs (any length, all-hex chars) are case-folded to lowercase.
 * Bech32 `npub1...` inputs are decoded via nostr-tools to their hex form.
 * Anything else returns `undefined` so a malformed entry can't break the
 * verification of sibling sources.
 *
 * NUT-06 lets `contact[?method=nostr].info` be either a hex pubkey OR an
 * `npub1...` bech32 string. Hex strings in the wild are typically 64 chars
 * (event signer x-only) or 66 chars (mint SEC1-compressed) — we don't gate
 * on length here so info.pubkey strings of either shape are comparable.
 */
function normalizeSignerIdentity(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  // Bech32 npub fast path. nip19.decode throws on bad input (bad bech32
  // checksum, wrong prefix, etc.); we swallow and return undefined so a
  // malformed contact entry can't break verification of the others.
  if (trimmed.toLowerCase().startsWith("npub1")) {
    try {
      const decoded = nip19.decode(trimmed);
      if (decoded.type === "npub" && typeof decoded.data === "string") {
        return decoded.data.toLowerCase();
      }
    } catch {
      // Fall through to undefined.
    }
    return undefined;
  }
  // Hex pubkey path: any hex-only string is comparable. We don't enforce a
  // canonical length because (a) info.pubkey is sometimes 66-char SEC1 and
  // sometimes 64-char x-only in the ecosystem (per audit/dtag.ts), and (b)
  // synthetic-fixture-driven tests use shorter forms — gating on length
  // here would silently break verification for legitimate variants.
  if (/^[0-9a-fA-F]+$/.test(trimmed)) return trimmed.toLowerCase();
  return undefined;
}

/**
 * Collect the candidate signer identities from a single /v1/info response.
 * Returns lowercase-hex strings; deduplicates so an emitter that lists the
 * same identity in both `pubkey` and `contact.nostr` doesn't double-count.
 *
 * Does NOT enforce ordering between sources — Layer B treats any match as
 * positive evidence (P0.1 widening). Order in the returned array is
 * `pubkey` first, then contact entries in source order, only because that
 * keeps the diagnostic mismatch reason string readable.
 */
function collectSignerSources(info: MintInfoV1): string[] {
  const sources: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string | undefined) => {
    if (raw === undefined) return;
    const norm = normalizeSignerIdentity(raw);
    if (norm === undefined) return;
    if (seen.has(norm)) return;
    seen.add(norm);
    sources.push(norm);
  };
  if (typeof info.pubkey === "string") push(info.pubkey);
  if (Array.isArray(info.contact)) {
    for (const entry of info.contact) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as { method?: unknown; info?: unknown };
      if (e.method !== "nostr") continue;
      if (typeof e.info !== "string") continue;
      push(e.info);
    }
  }
  return sources;
}

/**
 * Verify the signer-binding for a single announcement against the live
 * mint(s) it claims to represent.
 *
 * P0.1: matches event signer against EITHER `info.pubkey` OR
 * `info.contact[?method=nostr].info` (npub or hex). Any positive match
 * verifies. A mismatch against ALL declared sources is a real `false`
 * verdict; an ok response with NO usable signer source at all is a
 * transient `no-signer-source` (scheduler persists `null`).
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

  const signerPubkey = announcement.pubkey.toLowerCase();
  const fetched: Array<{ url: string; result: MintInfoResult }> = [];

  for (const url of urls) {
    const result = await fetcher(url);
    fetched.push({ url, result });
    if (!result.ok) continue;
    const sources = collectSignerSources(result.info);
    if (sources.includes(signerPubkey)) {
      // Record WHICH url verified so the scheduler can write the canonical
      // URL into MintInfoRow rather than guessing `u[0]`.
      return { verified: true, url, info: result.info };
    }
  }

  // No URL produced a positive match. Distinguish three failure modes for
  // the scheduler's persistence policy:
  //   1. Every fetch failed → transient `all-fetches-failed`.
  //   2. At least one fetch succeeded but NONE of the ok responses had any
  //      usable signer source (no pubkey AND no contact.nostr) →
  //      transient `no-signer-source` (genuinely unverifiable).
  //   3. At least one fetch succeeded with usable signer evidence, but
  //      none matched → real `pubkey-mismatch` verdict.
  const okFetches = fetched.filter((f) => f.result.ok);
  if (okFetches.length === 0) {
    return { verified: false, reason: "all-fetches-failed" };
  }

  // Aggregate the candidate signer sources across all ok responses to
  // decide between `no-signer-source` (nothing to compare) and
  // `pubkey-mismatch` (something to compare, just nothing matched).
  const allSources: string[] = [];
  for (const f of okFetches) {
    if (!f.result.ok) continue;
    for (const s of collectSignerSources(f.result.info)) {
      if (!allSources.includes(s)) allSources.push(s);
    }
  }

  if (allSources.length === 0) {
    return { verified: false, reason: "no-signer-source" };
  }

  const mismatchSummary = allSources.length === 1 ? allSources[0] : `[${allSources.join(", ")}]`;
  return {
    verified: false,
    reason: `pubkey-mismatch: signer=${signerPubkey} sources=${mismatchSummary}`,
  };
}
