/**
 * Layer A d-tag shape validator for NIP-87 Cashu mint announcements.
 *
 * Empirical finding: zero real kind:38172 events in the wild conform to
 * the strict 66-char compressed secp256k1 form per NUT-00 spec. Every
 * real Cashu mint (e.g. Nostrodomo 5fe928ae...) publishes a 64-char
 * x-only pubkey. A strict 66-char-only regex would reject 100% of real
 * mints AND bot spam, defeating Layer A's purpose.
 *
 * The accepted shape is therefore the union of:
 *   - 64-char x-only secp256k1 (de-facto form real Cashu mints publish)
 *   - 66-char with `02`/`03` prefix = compressed secp256k1 per NUT-00 spec
 *
 * Layer B (NUT-06 signer binding via /v1/info) is a follow-up check that
 * lives in PR #4 and confirms the pubkey corresponds to an actual Cashu
 * mint. Layer A alone is cheap and still rejects:
 *   - Bot spam with random 16-char d-tags (959 events from 2025-02-13 per
 *     /srv/forge/projects/bitcoinmints/audit/relay-strategy-v1.md §4)
 *   - Any non-hex garbage
 *   - Wrong-length hex
 *
 * Fedimint (kind:38173) d-tags are federation IDs (different shape) —
 * this validator applies to Cashu only (kind:38172). See TODO-v1.1 in
 * parse.ts for Fedimint federation-id validation.
 */
// 64-char = x-only secp256k1 (de-facto form real Cashu mints publish)
// 66-char with 02/03 prefix = compressed secp256k1 per NUT-00 spec
// Bot spam (16-char random d-tags) rejected by both branches.
export const D_TAG_REGEX = /^([0-9a-f]{64}|0[23][0-9a-f]{64})$/;

/**
 * Fedimint federation-id d-tag shape. Every real Fedimint federation ID
 * observed in the audit corpus (see `audit/fedimint-observer.md` and
 * `packages/core/src/reviews/corpus.test.ts`) is lowercase 64-char hex —
 * the blake3 hash of the federation's consensus public key, serialized as
 * 32 bytes of hex. A short/junk d-tag with `k=38173` slapped on is bot
 * spam, not a federation, and must be rejected by the same Layer A
 * firewall that catches 16-char Cashu bot spam.
 *
 * Keeping this sibling to `D_TAG_REGEX` so both Layer A shape gates live
 * in one file — a reviewer touching one will see the other immediately.
 */
export const FEDIMINT_D_TAG_REGEX = /^[0-9a-f]{64}$/;

/**
 * True iff `d` is either a 64-char x-only secp256k1 pubkey or a 66-char
 * compressed secp256k1 pubkey, both lowercase hex.
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
