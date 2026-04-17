import type { Event as NostrEvent } from "nostr-tools/core";

export type MintAnnouncementNetwork = "mainnet" | "testnet" | "signet" | "regtest";

/**
 * Parsed NIP-87 mint announcement (kind:38172 Cashu or kind:38173 Fedimint).
 *
 * This is a parsing result only — no validation of pubkey-vs-signer, no
 * /v1/info enrichment, no ranking. Pure event-to-shape transformation.
 * Layer A d-tag shape validation lives in dtag.ts; call
 * isValidCashuDTag(a.d) separately when filtering the Cashu subset.
 */
export type MintAnnouncement = {
  eventId: string;
  kind: 38172 | 38173;
  /** Signer of the event — NOT necessarily the mint operator. */
  pubkey: string;
  createdAt: number;
  /**
   * Parameterized-replaceable d-tag.
   *   - Cashu (kind:38172): mint's compressed secp256k1 pubkey per spec
   *     (see dtag.ts for Layer A validation).
   *   - Fedimint (kind:38173): federation id (TODO-v1.1: shape validator
   *     for federation ids).
   */
  d: string;
  /**
   * Canonical mint URL(s) for Cashu, or invite codes for Fedimint.
   * Collected from all `u` tags in the event.
   */
  u: string[];
  /** Cashu only: parsed from comma-joined `nuts` tag. Not present for Fedimint. */
  nuts?: number[];
  /** Fedimint only: parsed from comma-joined `modules` tag. Not present for Cashu. */
  modules?: string[];
  /** Network from optional `n` tag, when it's one of the known Bitcoin networks. */
  n?: MintAnnouncementNetwork;
  /**
   * kind-0-style JSON metadata embedded in the event content. May be
   * absent (empty content), malformed (non-JSON content), or present. We
   * tolerate all three and surface the parse result (or undefined).
   */
  contentMetadata?: {
    name?: string;
    about?: string;
    picture?: string;
    nuts?: number[];
    [key: string]: unknown;
  };
  /** Original event — preserved for rehydration and downstream signatures. */
  raw: NostrEvent;
};

/**
 * Parsed NIP-87 mint recommendation / review (kind:38000).
 *
 * Uniquely keyed by (pubkey, d) per NIP-87 parameterized-replaceable semantics.
 */
export type MintRecommendation = {
  eventId: string;
  kind: 38000;
  /** Reviewer (event signer). */
  pubkey: string;
  createdAt: number;
  /**
   * Target mint identifier — matches an announcement's d-tag. For Cashu
   * this should be a 66-char compressed pubkey; for Fedimint, a
   * federation id. Legacy events and bot spam use other shapes — the
   * parser is lenient and preserves whatever is there.
   */
  d: string;
  /** Parsed 0..5 rating (inclusive). See parse.ts for format precedence. */
  rating?: number;
  /** Freeform review text — may include a `[N/5]` prefix, may be empty. */
  content: string;
  /** Referenced announcement kind from optional `k` tag (38172 or 38173). */
  k?: number;
  raw: NostrEvent;
};
