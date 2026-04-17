/**
 * Dexie (IndexedDB) schema for the bitcoinmints cache.
 *
 * Tables map 1:1 to the parsing and enrichment layers:
 *   - announcements  — parsed kind:38172 / kind:38173 events
 *   - reviews        — parsed kind:38000 events
 *   - profiles       — kind:0 JSON-content metadata
 *   - relayLists     — kind:10002 NIP-65 relay lists
 *   - mintInfo       — /v1/info responses (PR #4 populates this)
 *   - mintAggregate  — ranking aggregates (PR #5 populates this)
 *
 * Replaceable-event uniqueness is encoded via Dexie compound primary keys
 * `[pubkey+kind+d]` on announcements and reviews so the DB enforces the
 * NIP-01 parameterized-replaceable invariant: one (signer, kind, d-tag)
 * triple == one row.
 *
 * The row shapes here are derived from but DISTINCT from the parse-layer
 * types (./nip87/types.ts). The cache has to hold forms the parser
 * doesn't, e.g. un-parsed raw kind:0 content, /v1/info fetch metadata,
 * and liveness state. Keeping these separate keeps the parse layer pure
 * and lets the cache evolve independently.
 */
import Dexie, { type Table } from "dexie";

/** Parsed NIP-87 mint announcement row. */
export type AnnouncementRow = {
  // Composite primary key: [pubkey+kind+d] uniqueness for replaceable semantics.
  pubkey: string;
  kind: 38172 | 38173;
  /** Mint hex pubkey (Cashu, 64- or 66-char) or federation id (Fedimint). */
  d: string;
  eventId: string;
  createdAt: number;
  /** Canonical mint URL(s) for Cashu, or invite codes for Fedimint. */
  u: string[];
  /** Cashu only — parsed from comma-joined `nuts` tag. */
  nuts?: number[];
  /** Fedimint only — parsed from comma-joined `modules` tag. */
  modules?: string[];
  /** Optional Bitcoin network tag (`n`). */
  n?: string;
  /** Original event content. */
  content: string;
  /** Original event tags (preserved verbatim for downstream rehydration). */
  rawTags: string[][];
  /**
   * Signer-binding verification (Layer B). Populated by PR #4. `null`
   * while unverified; `true` or `false` once /v1/info has been
   * reconciled against the signer pubkey.
   */
  verifiedBySignerBinding: boolean | null;
};

/** Parsed NIP-87 mint recommendation / review row. */
export type ReviewRow = {
  pubkey: string;
  kind: 38000;
  /** Target mint identifier (matches an announcement's d-tag). */
  d: string;
  eventId: string;
  createdAt: number;
  /** Pointer-kind tag: 38172 (Cashu) or 38173 (Fedimint). */
  k?: number;
  /** Parsed 0..5 rating. */
  rating?: number;
  /** Freeform review text. */
  content: string;
  rawTags: string[][];
};

/** NIP-01 kind:0 profile metadata row. */
export type ProfileRow = {
  pubkey: string;
  eventId: string;
  createdAt: number;
  name?: string;
  displayName?: string;
  picture?: string;
  about?: string;
  nip05?: string;
  /** Original JSON string — preserved for re-parsing if the shape evolves. */
  rawContent: string;
};

/** NIP-65 kind:10002 relay-list row. */
export type RelayListRow = {
  pubkey: string;
  eventId: string;
  createdAt: number;
  relays: Array<{ url: string; read: boolean; write: boolean }>;
};

/**
 * /v1/info response row (populated in PR #4 — empty in PR #3).
 * Keyed by the announcement `d` the info corresponds to.
 */
export type MintInfoRow = {
  /** Matches the announcement d-tag. */
  d: string;
  /** Canonical /v1/info URL chosen for this mint. */
  url: string;
  /** Epoch-ms timestamp of the fetch (used for CAS). */
  fetchedAt: number;
  /** Raw /v1/info response. */
  infoJson: Record<string, unknown>;
  /** HTTP ETag, if the server returns one. */
  etag?: string;
  /** Whether the last fetch succeeded. */
  ok: boolean;
  /** Last error message, if ok === false. */
  lastError?: string;
};

/** Aggregated per-mint ranking row (populated in PR #5 — empty in PR #3). */
export type MintAggregateRow = {
  d: string;
  reviewCount: number;
  averageRating?: number;
  bayesianRank?: number;
  /** Epoch-ms timestamp of the aggregate recompute (used for CAS). */
  updatedAt: number;
};

/** Dexie handle for the bitcoinmints IndexedDB database. */
export class BitcoinmintsDB extends Dexie {
  announcements!: Table<AnnouncementRow, [string, number, string]>;
  reviews!: Table<ReviewRow, [string, number, string]>;
  profiles!: Table<ProfileRow, string>;
  relayLists!: Table<RelayListRow, string>;
  mintInfo!: Table<MintInfoRow, string>;
  mintAggregate!: Table<MintAggregateRow, string>;

  constructor(name = "bitcoinmints") {
    super(name);
    // Dexie compound primary-key syntax: "[a+b+c]" — first entry is the PK,
    // remaining entries are secondary indexes for efficient range queries.
    this.version(1).stores({
      announcements: "[pubkey+kind+d], eventId, kind, d, createdAt",
      reviews: "[pubkey+kind+d], eventId, d, createdAt, k",
      profiles: "pubkey, createdAt",
      relayLists: "pubkey, createdAt",
      mintInfo: "d, fetchedAt, ok",
      mintAggregate: "d, bayesianRank, updatedAt",
    });
    // v2: add compound `[kind+createdAt]` index on announcements so the
    // scheduler's restoreWatermarks() can do a bounded `.last()` lookup
    // per kind instead of materializing the entire table via .sortBy().
    // Dexie auto-migrates additive index changes; existing rows get re-
    // indexed on first open. fake-indexeddb supports compound indexes
    // (verified in scheduler.restoreWatermarks watermark-restore tests).
    this.version(2).stores({
      announcements: "[pubkey+kind+d], eventId, kind, d, createdAt, [kind+createdAt]",
    });
  }
}
