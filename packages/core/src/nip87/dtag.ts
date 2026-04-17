/**
 * Layer A d-tag shape validator for NIP-87 Cashu mint announcements.
 *
 * Per NUT-00 / NIP-87, a Cashu mint's announcement d-tag SHOULD be the
 * mint's compressed secp256k1 public key (66 hex chars, starting with
 * `02` or `03`). Layer B (NUT-06 signer binding via /v1/info) is a
 * follow-up check that lives in PR #4.
 *
 * Layer A alone is cheap and sufficient to reject:
 *   - Bot spam with random 16-char d-tags (959 events from 2025-02-13 per
 *     /srv/forge/projects/bitcoinmints/audit/relay-strategy-v1.md §4)
 *   - Legacy 64-char raw-pubkey d-tags (pre-spec)
 *   - Any non-hex garbage
 *
 * It does NOT verify that the pubkey corresponds to an actual Cashu mint.
 * That's Layer B.
 *
 * Fedimint (kind:38173) d-tags are federation IDs (different shape) —
 * this validator applies to Cashu only (kind:38172). See TODO-v1.1 in
 * parse.ts for Fedimint federation-id validation.
 */
export const D_TAG_REGEX = /^0[23][0-9a-f]{64}$/;

/**
 * True iff `d` is a 66-char compressed secp256k1 pubkey in lowercase hex.
 */
export function isValidCashuDTag(d: string): boolean {
  return D_TAG_REGEX.test(d);
}
