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
 * isValidCashuDTag(d). Post-2026-04-17 the Cashu gate only rejects empty /
 * oversized / non-printable-ASCII d-tags — the earlier strict pubkey regex
 * rejected 99.8% of real on-wire events (see dtag.ts for the relaxation
 * note). URL + Layer B signer binding are the real verification gates.
 * kind:38173 (Fedimint) uses a sibling shape gate (isValidFedimintDTag) —
 * every real federation ID in the audit corpus is 64-char lowercase hex,
 * and that gate is unchanged by the Cashu relaxation.
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
  // Tiebreak: lexicographically higher eventId wins.
  return next.eventId > prev.eventId;
}

/** Upsert a kind:38172 or kind:38173 announcement with Layer A gating on both kinds. */
export async function upsertAnnouncement(
  db: BitcoinmintsDB,
  row: AnnouncementRow,
): Promise<UpsertResult> {
  // Layer A gate — reject invalid d-tag shapes before touching the DB.
  // Cashu (38172) accepts any non-empty printable-ASCII d-tag up to 256
  // chars (post-2026-04-17 relaxation — see dtag.ts). Fedimint (38173)
  // requires a 64-char lowercase hex federation-id shape — unchanged by
  // the Cashu relaxation; junk d-tags with k=38173 still get filtered.
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
 * The review's `d` points at a mint. When `k === 38172` (or `k` is absent,
 * which is how most in-the-wild Cashu reviews shape), we apply the same
 * Layer A gate that `upsertAnnouncement` uses — post-relaxation, that
 * means rejecting only empty / oversized / non-printable d-tags. URL +
 * Layer B are the real verification gates on the mint side; here we just
 * ensure the d pointer itself is a well-formed string.
 *
 * `k === 38173` (Fedimint) switches to the sibling `isValidFedimintDTag`
 * shape gate — every real federation ID in the audit corpus is lowercase
 * 64-char hex. This gate is unchanged by the Cashu relaxation.
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
  // Reviews point at a target mint via `d`; the pointer-kind `k` selects
  // which shape gate applies. No `k` tag → treat as Cashu (the default
  // for in-the-wild events per rating-tag-research §3). The Cashu gate is
  // relaxed (any non-empty printable ASCII); the Fedimint gate remains
  // 64-char hex.
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
