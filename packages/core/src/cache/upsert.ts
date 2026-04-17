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
 * (Fedimint) bypasses Layer A — federation IDs have a different shape
 * and their validator is a TODO-v1.1 concern.
 *
 * mintInfo and mintAggregate aren't event-based, so their CAS predicate
 * is a monotonically-increasing timestamp: `fetchedAt` for mintInfo,
 * `updatedAt` for mintAggregate.
 */
import { isValidCashuDTag } from "../nip87/dtag";
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
  // Tiebreak: lexicographically higher eventId wins.
  return next.eventId > prev.eventId;
}

/** Upsert a kind:38172 or kind:38173 announcement with Layer A gating on 38172. */
export async function upsertAnnouncement(
  db: BitcoinmintsDB,
  row: AnnouncementRow,
): Promise<UpsertResult> {
  // Layer A gate — reject invalid Cashu d-tag shapes before touching the DB.
  // Fedimint (38173) bypasses: federation-id shape is TODO-v1.1.
  if (row.kind === 38172 && !isValidCashuDTag(row.d)) {
    return "rejected-invalid";
  }

  return db.transaction("rw", db.announcements, async () => {
    const prev = await db.announcements.get([row.pubkey, row.kind, row.d]);
    if (!prev) {
      await db.announcements.put(row);
      return "inserted";
    }
    if (nextWins(prev, row)) {
      await db.announcements.put(row);
      return "replaced";
    }
    return "rejected-stale";
  });
}

/** Upsert a kind:38000 review. No Layer A gate — the `d` here points at a mint but isn't itself a Cashu pubkey owned by the reviewer. */
export async function upsertReview(db: BitcoinmintsDB, row: ReviewRow): Promise<UpsertResult> {
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
