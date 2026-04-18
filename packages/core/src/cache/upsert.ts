/**
 * Compare-and-swap (CAS) upsert helpers for the bitcoinmints cache.
 *
 * Every upsert runs inside a Dexie read-write transaction so the
 * read-compare-write cycle is atomic. Without that, concurrent ingest
 * from multiple relays can race and leave older events overwriting newer
 * ones.
 *
 * Replaceable-event ordering rules (per NIP-01 §7.3 / NIP-33):
 *   1. Higher `createdAt` wins.
 *   2. Tiebreak — when `createdAt` is equal, the event with the higher
 *      `eventId` (string compare on lowercase hex) wins. This is the
 *      standard replaceable-event tiebreak clients converge on.
 *
 * Layer A gate for kind:38172: before writing an announcement we check
 * isValidCashuDTag(d). Invalid shapes (bot spam, non-hex garbage) are
 * returned as "rejected-invalid" and never hit the DB. kind:38173
 * (Fedimint) uses a sibling shape gate (isValidFedimintDTag) — every real
 * federation ID in the audit corpus is 64-char lowercase hex, so short /
 * junk d-tags with `["k","38173"]` are still filtered at the same choke
 * point as Cashu bot spam.
 *
 * mintInfo and mintAggregate aren't event-based, so their CAS predicate
 * is a monotonically-increasing timestamp: `fetchedAt` for mintInfo,
 * `updatedAt` for mintAggregate.
 */
import { isValidCashuDTag, isValidFedimintDTag } from "../nip87/dtag";
import type {
  AnnouncementRow,
  BitcoinmintsDB,
  MintAggregateRow,
  MintInfoRow,
  ProfileRow,
  RelayListRow,
  ReviewRow,
} from "./schema";

/**
 * Outcome of an upsert attempt.
 *   - "inserted"          — no prior row; the new row was written.
 *   - "replaced"          — a prior row existed and was overwritten.
 *   - "rejected-stale"    — a prior row existed and was kept (newer or tiebreak-winning).
 *   - "rejected-invalid"  — the row failed a pre-write validator (e.g. Layer A d-tag shape).
 */
export type UpsertResult = "inserted" | "replaced" | "rejected-stale" | "rejected-invalid";

/**
 * Decide whether `next` supersedes `prev` by NIP-01 replaceable-event rules.
 * Returns true iff `next` should overwrite `prev`.
 */
function nextWins(
  prev: { createdAt: number; eventId: string },
  next: { createdAt: number; eventId: string },
): boolean {
  if (next.createdAt > prev.createdAt) return true;
  if (next.createdAt < prev.createdAt) return false;
  // Tiebreak: per NIP-01, the event with the LOWEST id (first in lexical
  // order) is retained. So `next` supersedes `prev` only when next.eventId
  // is lex-lower than prev.eventId. Equal ids are a no-op (false).
  return next.eventId < prev.eventId;
}

/** Upsert a kind:38172 or kind:38173 announcement with Layer A gating on both kinds. */
export async function upsertAnnouncement(
  db: BitcoinmintsDB,
  row: AnnouncementRow,
): Promise<UpsertResult> {
  // Layer A gate — reject invalid d-tag shapes before touching the DB.
  // Cashu (38172) requires a 64- or 66-char secp256k1 pubkey shape;
  // Fedimint (38173) requires a 64-char lowercase hex federation-id shape.
  // A short/junk d-tag with `k=38173` slapped on is still bot spam and
  // must be caught by the same firewall — don't free-pass by kind alone.
  if (row.kind === 38173) {
    if (!isValidFedimintDTag(row.d)) return "rejected-invalid";
  } else if (!isValidCashuDTag(row.d)) {
    return "rejected-invalid";
  }

  return db.transaction("rw", db.announcements, async () => {
    const prev = await db.announcements.get([row.pubkey, row.kind, row.d]);
    if (!prev) {
      await db.announcements.put(row);
      return "inserted";
    }
    if (nextWins(prev, row)) {
      // Preserve Layer B verification across CAS replace. The parser doesn't
      // know about /v1/info reconciliation, so an incoming row always carries
      // verifiedBySignerBinding: null. Without this merge, a newer event would
      // clobber a prior `true`/`false` set by PR #4's verifier.
      await db.announcements.put({
        ...row,
        verifiedBySignerBinding: prev.verifiedBySignerBinding ?? row.verifiedBySignerBinding,
      });
      return "replaced";
    }
    return "rejected-stale";
  });
}

/**
 * Upsert a kind:38000 review with Layer A gating on the target `d` tag.
 *
 * The review's `d` points at a mint. The pointer-kind `k` selects which
 * shape gate applies: `k === 38173` uses `isValidFedimintDTag`, else
 * `isValidCashuDTag`. P0.3: `parseReview` rejects events without a valid
 * `k` tag at parse, so by the time a row reaches this function, `k` is
 * always set (38172 or 38173). The previous fallback ("no k → default to
 * Cashu") silently misrouted Fedimint reviews and let bot spam through.
 *
 * Note: this low-level upsert is the mechanical write. It does NOT
 * materialize the `mintAggregate` row — the `reviews/` wrapper composes
 * this with `recomputeAggregateInTx` inside a single transaction so the
 * two stores stay in sync. Callers outside `reviews/` (integration tests,
 * direct usage) can call this helper directly and will simply skip the
 * aggregate materialization — safe but stale.
 */
export async function upsertReview(db: BitcoinmintsDB, row: ReviewRow): Promise<UpsertResult> {
  // Layer A gate — reject invalid d-tag shapes before touching the DB.
  // P0.3: `k` is required at parse time, so we route purely on its value;
  // no implicit Cashu default for missing k.
  if (row.k === 38173) {
    if (!isValidFedimintDTag(row.d)) return "rejected-invalid";
  } else if (!isValidCashuDTag(row.d)) {
    return "rejected-invalid";
  }
  return db.transaction("rw", db.reviews, async () => {
    const prev = await db.reviews.get([row.pubkey, row.kind, row.d]);
    if (!prev) {
      await db.reviews.put(row);
      return "inserted";
    }
    if (nextWins(prev, row)) {
      await db.reviews.put(row);
      return "replaced";
    }
    return "rejected-stale";
  });
}

/** Upsert a kind:0 profile. Keyed by pubkey (NIP-01 replaceable). */
export async function upsertProfile(db: BitcoinmintsDB, row: ProfileRow): Promise<UpsertResult> {
  return db.transaction("rw", db.profiles, async () => {
    const prev = await db.profiles.get(row.pubkey);
    if (!prev) {
      await db.profiles.put(row);
      return "inserted";
    }
    if (nextWins(prev, row)) {
      await db.profiles.put(row);
      return "replaced";
    }
    return "rejected-stale";
  });
}

/** Upsert a kind:10002 relay list. Keyed by pubkey (NIP-01 replaceable). */
export async function upsertRelayList(
  db: BitcoinmintsDB,
  row: RelayListRow,
): Promise<UpsertResult> {
  return db.transaction("rw", db.relayLists, async () => {
    const prev = await db.relayLists.get(row.pubkey);
    if (!prev) {
      await db.relayLists.put(row);
      return "inserted";
    }
    if (nextWins(prev, row)) {
      await db.relayLists.put(row);
      return "replaced";
    }
    return "rejected-stale";
  });
}

/** Upsert a /v1/info row. CAS predicate: higher `fetchedAt` wins. */
export async function upsertMintInfo(db: BitcoinmintsDB, row: MintInfoRow): Promise<UpsertResult> {
  return db.transaction("rw", db.mintInfo, async () => {
    const prev = await db.mintInfo.get(row.d);
    if (!prev) {
      await db.mintInfo.put(row);
      return "inserted";
    }
    if (row.fetchedAt > prev.fetchedAt) {
      await db.mintInfo.put(row);
      return "replaced";
    }
    return "rejected-stale";
  });
}

/** Upsert an aggregate row. CAS predicate: higher `updatedAt` wins. */
export async function upsertMintAggregate(
  db: BitcoinmintsDB,
  row: MintAggregateRow,
): Promise<UpsertResult> {
  return db.transaction("rw", db.mintAggregate, async () => {
    const prev = await db.mintAggregate.get(row.d);
    if (!prev) {
      await db.mintAggregate.put(row);
      return "inserted";
    }
    if (row.updatedAt > prev.updatedAt) {
      await db.mintAggregate.put(row);
      return "replaced";
    }
    return "rejected-stale";
  });
}
