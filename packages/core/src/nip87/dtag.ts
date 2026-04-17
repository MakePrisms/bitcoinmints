/**
 * Layer A d-tag shape validator for NIP-87 Cashu mint announcements.
 *
 * Empirical finding (PR #32 browser demo, 2026-04-17): of 500 on-wire
 * `{kinds:[38172]}` events from nos.lol, 499 use 16-char random d-tags
 * and point at legitimate operational mints — mint.coinos.io,
 * stablenut.umint.cash, cashu.boats, mint.lnvoltz.com, etc. The earlier
 * "bot spam with fabricated d-tags" reading was wrong: one non-spec
 * curator publishes real mint URLs under random d-tags. A strict regex
 * (64-char x-only or 66-char compressed secp256k1) rejects 99.8% of the
 * real ecosystem — only sharegap.net passes, and it has zero reviews.
 *
 * Decision (gudnuf, 2026-04-17): relax d-tag shape filtering. The URL
 * is the mint's identity, not the d-tag. Trust Layer B (NUT-06 signer
 * binding via /v1/info) + URL as the real verification gate; use Layer A
 * only to reject unambiguous garbage (empty, oversized, non-printable).
 *
 * Later analysis (deferred) will re-examine the on-wire corpus and may
 * tighten this back once we understand the shape distribution.
 */
// Accept any non-empty printable-ASCII d-tag up to 256 chars. Rejects only
// empty, oversized (>256), or non-printable/high-byte garbage. Chosen over
// [A-Za-z0-9_\-] because real curator d-tags in the wild mix unexpected
// characters and we'd rather gate on URL + Layer B than relitigate shape.
export const D_TAG_REGEX = /^[\x20-\x7E]{1,256}$/;

/**
 * Fedimint federation-id d-tag shape. Every real Fedimint federation ID
 * observed in the audit corpus (see `audit/fedimint-observer.md` and
 * `packages/core/src/reviews/corpus.test.ts`) is lowercase 64-char hex —
 * the blake3 hash of the federation's consensus public key, serialized as
 * 32 bytes of hex. This gate is unchanged by the 2026-04-17 Cashu
 * relaxation; a short/junk d-tag with `k=38173` slapped on is still not
 * a federation and gets rejected here.
 *
 * Keeping this sibling to `D_TAG_REGEX` so both Layer A shape gates live
 * in one file — a reviewer touching one will see the other immediately.
 */
export const FEDIMINT_D_TAG_REGEX = /^[0-9a-f]{64}$/;

/**
 * True iff `d` is a non-empty printable-ASCII string up to 256 chars.
 * Per the relaxation recorded on D_TAG_REGEX above: shape is no longer
 * used to filter curator-style d-tags; URL + Layer B signer binding
 * are the real verification gates.
 */
export function isValidCashuDTag(d: string): boolean {
  return D_TAG_REGEX.test(d);
}

/**
 * True iff `d` is a lowercase 64-char hex Fedimint federation ID.
 */
export function isValidFedimintDTag(d: string): boolean {
  return FEDIMINT_D_TAG_REGEX.test(d);
}
