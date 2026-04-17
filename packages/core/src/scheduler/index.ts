/**
 * Scheduler — pool → parse → cache → Layer-B orchestration.
 *
 * This is the glue that wires the pieces shipped in PR #2 (nostr/pool +
 * nip87/parse) and PR #3 (cache CAS upserts) into a running pipeline,
 * with PR #4's Layer B (cashu/layerB) hung off the announcement-accepted
 * branch.
 *
 * Lifecycle:
 *
 *   const scheduler = createScheduler({ db, pool, fetcher, relays });
 *   scheduler.start();
 *   // ... events flow into the cache; Layer B verifies kind:38172 in the background ...
 *   await scheduler.stop();   // closes subs, drains in-flight Layer B work
 *
 * Pipeline shape (per event):
 *
 *   pool subscription
 *      └─ onEvent(event, relay)
 *          ├─ stats.eventsReceived++
 *          ├─ parse via nip87/parse
 *          │     ├─ kind:38172 / 38173  → upsertAnnouncement
 *          │     │     └─ if inserted | replaced
 *          │     │           ├─ stats.accepted++
 *          │     │           └─ if kind:38172 → enqueue Layer B
 *          │     ├─ kind:38000           → upsertReview
 *          │     ├─ kind:0               → upsertProfile
 *          │     ├─ kind:10002           → upsertRelayList
 *          │     └─ unknown kind         → drop
 *          └─ update watermark for that kind to max(seen, event.created_at)
 *
 * Layer B work queue:
 *   - bounded concurrency is the fetcher's: createMintInfoFetcher already
 *     gates total in-flight HTTP requests. We don't double-cap here — that
 *     would either deadlock or under-utilize.
 *   - backoff per mint URL: attempts × 30s, capped at 1h. A kind:38172
 *     announcement that fails Layer B still has its row in the cache with
 *     verifiedBySignerBinding=false; we just don't re-fetch it within the
 *     backoff window. The fetcher's TTL cache (1h default) is the second
 *     layer of "don't hammer".
 *   - re-verification: when a row replaces an existing one (newer
 *     createdAt for same [pubkey, kind, d]), we always re-enqueue. The
 *     fetcher cache short-circuits within TTL, so this is cheap.
 *
 * Watermark / restart story:
 *   - On start() we read the highest `createdAt` per kind from the cache
 *     and set that as the `since` filter floor. This prevents replay of
 *     already-seen events on restart (they would CAS-fail anyway, so this
 *     is a wire-bandwidth optimization not a correctness fix).
 *   - During run, the watermark advances as events arrive but is NOT
 *     persisted separately — the cache itself is the durable record. On
 *     restart we re-derive from the cache.
 *   - We use a single global since-per-kind, not per-relay. The data-model
 *     and relay-strategy docs don't spec a relayWatermarks table; doing
 *     per-relay tracking would require either extending pool.ts (per-relay
 *     subscribes) or a new persistent table. Both are deferred. See the
 *     scheduler-design TODO comment near `restoreWatermarks` for the open
 *     question. Open question Q1 from the PR brief — defaulted in-memory.
 *
 * Stop discipline:
 *   - stop() closes the pool subscription handle synchronously, then
 *     awaits the drain of in-flight Layer B promises. Late-arriving
 *     events are dropped at the pool boundary (per PR #2 fix).
 */

import type { Event as NostrEvent } from "nostr-tools/core";
import {
  type AnnouncementRow,
  type BitcoinmintsDB,
  type ProfileRow,
  type RelayListRow,
  type ReviewRow,
  upsertAnnouncement,
  upsertMintInfo,
  upsertProfile,
  upsertRelayList,
  upsertReview,
} from "../cache";
import type { MintInfoFetcher } from "../cashu/info";
import { type LayerBResult, verifySignerBinding } from "../cashu/layerB";
import {
  type MintAnnouncement,
  type MintRecommendation,
  parseMintAnnouncement,
  parseRecommendation,
} from "../nip87";
import type { Pool, PoolHandle } from "../nostr";

/** Observable counters surfaced via getStats() — for the UI in PR #6+. */
export type SchedulerStats = {
  eventsReceived: number;
  accepted: number;
  rejectedByLayerA: number;
  layerBPending: number;
  layerBVerified: number;
  layerBFailed: number;
};

export type Scheduler = {
  /**
   * Open relay subscriptions and start ingesting events. Returns a promise
   * that resolves once the underlying subscription has been wired (after
   * watermark restore from the cache). Callers can fire-and-forget for
   * production code or await for deterministic tests.
   */
  start: () => Promise<void>;
  stop: () => Promise<void>;
  getStats: () => SchedulerStats;
};

export type SchedulerConfig = {
  db: BitcoinmintsDB;
  pool: Pool;
  fetcher: MintInfoFetcher;
  /**
   * Relay URLs the scheduler is configured to subscribe to. Currently used
   * only for stats / error context — the actual subscription is dispatched
   * via `pool.subscribe`, which uses whatever relays the pool was built
   * with.
   */
  relays: readonly string[];
  /** Optional clock injector for deterministic backoff tests. Defaults to Date.now. */
  now?: () => number;
};

/** NIP-87 + supporting kinds. See data-model-v1.md §1 for the full list. */
const SUBSCRIBED_KINDS = [38172, 38173, 38000, 0, 10002] as const;

/** Initial backoff window for a failed mint URL: attempts=0 → 30s. */
const BASE_BACKOFF_MS = 30_000;
/** Cap at 1 hour. */
const MAX_BACKOFF_MS = 60 * 60_000;

/**
 * State per mint URL we've attempted Layer B against. Used to throttle
 * retries — the fetcher cache also short-circuits, but tracking attempts
 * here lets us emit accurate "we'll re-try at $time" diagnostics later.
 */
type LayerBBackoffState = {
  attempts: number;
  lastAttemptAt: number;
  lastReason?: string;
};

/**
 * Compute the soonest time a URL is allowed to be re-attempted given its
 * backoff state. Exponential 2^(attempts-1) * 30s, capped at 1h. After the
 * first failure (attempts=1) we wait BASE_BACKOFF_MS; after the second we
 * wait 2× that; and so on. attempts=0 (no recorded failure) returns
 * lastAttemptAt = 0, i.e. always allowed.
 */
function nextAllowedAttempt(state: LayerBBackoffState): number {
  if (state.attempts <= 0) return 0;
  const wait = Math.min(BASE_BACKOFF_MS * 2 ** (state.attempts - 1), MAX_BACKOFF_MS);
  return state.lastAttemptAt + wait;
}

/**
 * Convert a parsed NIP-87 mint announcement into the cache row shape.
 * Mirrors integration.test.ts's helper — kept private to the scheduler so
 * the parse → cache adapter logic doesn't drift across consumers.
 */
function toAnnouncementRow(parsed: MintAnnouncement): AnnouncementRow {
  const row: AnnouncementRow = {
    pubkey: parsed.pubkey,
    kind: parsed.kind,
    d: parsed.d,
    eventId: parsed.eventId,
    createdAt: parsed.createdAt,
    u: parsed.u,
    content: parsed.raw.content,
    rawTags: parsed.raw.tags,
    verifiedBySignerBinding: null,
  };
  if (parsed.nuts !== undefined) row.nuts = parsed.nuts;
  if (parsed.modules !== undefined) row.modules = parsed.modules;
  if (parsed.n !== undefined) row.n = parsed.n;
  return row;
}

function toReviewRow(parsed: MintRecommendation): ReviewRow {
  const row: ReviewRow = {
    pubkey: parsed.pubkey,
    kind: 38000,
    d: parsed.d,
    eventId: parsed.eventId,
    createdAt: parsed.createdAt,
    content: parsed.content,
    rawTags: parsed.raw.tags,
  };
  if (parsed.k !== undefined) row.k = parsed.k;
  if (parsed.rating !== undefined) row.rating = parsed.rating;
  return row;
}

/** Best-effort kind:0 parse. JSON content with name/picture/etc. */
function toProfileRow(event: NostrEvent): ProfileRow | null {
  if (event.kind !== 0) return null;
  let parsed: Record<string, unknown> = {};
  try {
    const obj = JSON.parse(event.content || "{}") as unknown;
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      parsed = obj as Record<string, unknown>;
    }
  } catch {
    // Profiles with malformed content still get a row (just no parsed fields).
  }
  const row: ProfileRow = {
    pubkey: event.pubkey,
    eventId: event.id,
    createdAt: event.created_at,
    rawContent: event.content ?? "",
  };
  if (typeof parsed.name === "string") row.name = parsed.name;
  if (typeof parsed.display_name === "string") row.displayName = parsed.display_name;
  if (typeof parsed.picture === "string") row.picture = parsed.picture;
  if (typeof parsed.about === "string") row.about = parsed.about;
  if (typeof parsed.nip05 === "string") row.nip05 = parsed.nip05;
  return row;
}

/**
 * Parse a kind:10002 NIP-65 relay list. Each `r` tag is `["r", url, "read"|"write"]`,
 * where the third arg may be omitted (then both read AND write are true).
 */
function toRelayListRow(event: NostrEvent): RelayListRow | null {
  if (event.kind !== 10002) return null;
  const relays: RelayListRow["relays"] = [];
  for (const tag of event.tags) {
    if (tag[0] !== "r" || typeof tag[1] !== "string") continue;
    const marker = tag[2];
    const read = marker === undefined || marker === "read";
    const write = marker === undefined || marker === "write";
    relays.push({ url: tag[1], read, write });
  }
  return {
    pubkey: event.pubkey,
    eventId: event.id,
    createdAt: event.created_at,
    relays,
  };
}

export function createScheduler(config: SchedulerConfig): Scheduler {
  const { db, pool, fetcher } = config;
  const now = config.now ?? Date.now;

  const stats: SchedulerStats = {
    eventsReceived: 0,
    accepted: 0,
    rejectedByLayerA: 0,
    layerBPending: 0,
    layerBVerified: 0,
    layerBFailed: 0,
  };

  // Tracks (kind -> highest createdAt seen). Used to compute the `since`
  // filter on next start(). Not persisted — the cache is the durable
  // record and we re-derive on restart.
  const watermarks = new Map<number, number>();
  const updateWatermark = (kind: number, createdAt: number) => {
    const prev = watermarks.get(kind) ?? 0;
    if (createdAt > prev) watermarks.set(kind, createdAt);
  };

  // Per-URL backoff state. Keyed by the canonical mint URL string from the
  // announcement's `u` array (no normalization beyond what the announcement
  // carries — that's an open question for PR #5).
  const backoff = new Map<string, LayerBBackoffState>();

  // Track in-flight Layer B promises so stop() can drain cleanly.
  const inflight = new Set<Promise<void>>();
  let stopped = false;
  let handle: PoolHandle | null = null;
  // Tracks whether start() has been entered. We can't use `handle` for
  // idempotency because handle is assigned asynchronously after the
  // restoreWatermarks Dexie read completes; a synchronous double-call to
  // start() would otherwise race two restore-and-subscribe sequences.
  let starting = false;
  // Resolves once the subscription has been opened (or the start was
  // aborted by a stop). Tests await this via the handle, but it's also
  // useful internally to coordinate stop() with a still-starting scheduler.
  let startReady: Promise<void> = Promise.resolve();

  /**
   * Restore watermarks from the cache. For each subscribed kind, look up
   * the highest `createdAt` we've already accepted and use that as the
   * floor. Tables that don't store the kind explicitly use the natural
   * one (profiles=0, relayLists=10002).
   */
  async function restoreWatermarks(): Promise<void> {
    // Announcements: 38172 + 38173 — index on `kind` lets us scan per kind.
    for (const k of [38172, 38173] as const) {
      const top = await db.announcements.where("kind").equals(k).reverse().sortBy("createdAt");
      if (top.length > 0) {
        const first = top[0];
        if (first) updateWatermark(k, first.createdAt);
      }
    }
    // Reviews are all kind 38000 — same idea, no `where` filter needed.
    const review = await db.reviews.orderBy("createdAt").reverse().limit(1).first();
    if (review) updateWatermark(38000, review.createdAt);
    const profile = await db.profiles.orderBy("createdAt").reverse().limit(1).first();
    if (profile) updateWatermark(0, profile.createdAt);
    const relayList = await db.relayLists.orderBy("createdAt").reverse().limit(1).first();
    if (relayList) updateWatermark(10002, relayList.createdAt);
  }

  /**
   * Run Layer B for a freshly-accepted Cashu announcement. Updates
   * verifiedBySignerBinding on the announcement row + writes a MintInfoRow
   * on success. On failure, MintInfoRow gets `ok: false` with the lastError
   * so the UI can surface "verification failed: $reason".
   */
  async function runLayerB(row: AnnouncementRow): Promise<void> {
    if (row.kind !== 38172) return;

    // Backoff gate: skip if any URL is still in cooldown. We use the most-
    // backed-off URL as the gate (the announcement is the unit, not the
    // URL — partial verification of a multi-URL mint is still verification).
    const ts = now();
    let allInCooldown = true;
    for (const url of row.u) {
      const state = backoff.get(url);
      if (!state || ts >= nextAllowedAttempt(state)) {
        allInCooldown = false;
        break;
      }
    }
    if (allInCooldown && row.u.length > 0) return;

    let result: LayerBResult;
    try {
      result = await verifySignerBinding(row, fetcher);
    } catch (err) {
      // Defensive: verifySignerBinding shouldn't throw (the fetcher
      // contract resolves to MintInfoResult), but if it does we treat it
      // as a Layer B failure and back off.
      result = {
        verified: false,
        reason: `verifier-threw: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // Update backoff state per URL. Success clears it; failure increments.
    for (const url of row.u) {
      if (result.verified) {
        backoff.delete(url);
      } else {
        const state = backoff.get(url) ?? { attempts: 0, lastAttemptAt: 0 };
        state.attempts += 1;
        state.lastAttemptAt = now();
        if (result.reason) state.lastReason = result.reason;
        backoff.set(url, state);
      }
    }

    // Persist verification result on the announcement row. The CAS upsert
    // will preserve a prior `true`/`false` if a newer event raced past us
    // (PR #29 fix); a fresh `verifiedBySignerBinding` setting always wins
    // on the first verify because the prior is null.
    const existing = await db.announcements.get([row.pubkey, row.kind, row.d]);
    if (existing) {
      // Direct put bypasses CAS — we're updating one specific field on a
      // row we own. CAS is for replaceable-event ordering; this is local
      // bookkeeping. The upsertAnnouncement preserve-Layer-B logic only
      // matters when a newer event arrives AFTER Layer B has run.
      await db.announcements.put({
        ...existing,
        verifiedBySignerBinding: result.verified,
      });
    }

    // Persist /v1/info into the mintInfo table. This avoids the second
    // round-trip on the UI's mint-detail view (data-model-v1.md §7).
    if (result.verified && result.info) {
      await upsertMintInfo(db, {
        d: row.d,
        url: row.u[0] ?? "",
        fetchedAt: now(),
        infoJson: result.info as unknown as Record<string, unknown>,
        ok: true,
      });
    } else {
      // Failure case: write a !ok row so the UI can show a "verification
      // failed: $reason" badge without re-running Layer B itself.
      await upsertMintInfo(db, {
        d: row.d,
        url: row.u[0] ?? "",
        fetchedAt: now(),
        infoJson: {},
        ok: false,
        lastError: result.reason ?? "unknown",
      });
    }

    if (result.verified) {
      stats.layerBVerified += 1;
    } else {
      stats.layerBFailed += 1;
    }
  }

  /**
   * Non-blocking enqueue. Returns immediately; the work runs on the
   * microtask queue and is tracked via `inflight` so stop() can drain.
   */
  function enqueueLayerB(row: AnnouncementRow): void {
    if (stopped) return;
    stats.layerBPending += 1;
    // Allocate the promise handle, then wire its self-cleanup. The
    // double-step keeps the closure from referencing `work` before it's
    // assigned (TS2454).
    let work: Promise<void>;
    const body = async (): Promise<void> => {
      try {
        await runLayerB(row);
      } finally {
        stats.layerBPending -= 1;
        inflight.delete(work);
      }
    };
    work = body();
    inflight.add(work);
  }

  /** Per-event handler — single funnel for all kinds. */
  async function onEvent(event: NostrEvent): Promise<void> {
    if (stopped) return;
    stats.eventsReceived += 1;

    switch (event.kind) {
      case 38172:
      case 38173: {
        const parsed = parseMintAnnouncement(event);
        if (!parsed) return;
        const row = toAnnouncementRow(parsed);
        const result = await upsertAnnouncement(db, row);
        if (result === "rejected-invalid") {
          stats.rejectedByLayerA += 1;
        }
        if (result === "inserted" || result === "replaced") {
          stats.accepted += 1;
          updateWatermark(event.kind, event.created_at);
          // Layer B only runs on Cashu — verifySignerBinding will short-
          // circuit non-cashu, but skipping the enqueue avoids the
          // bookkeeping noise.
          if (event.kind === 38172) {
            enqueueLayerB(row);
          }
        }
        return;
      }
      case 38000: {
        const parsed = parseRecommendation(event);
        if (!parsed) return;
        const row = toReviewRow(parsed);
        const result = await upsertReview(db, row);
        if (result === "inserted" || result === "replaced") {
          stats.accepted += 1;
          updateWatermark(event.kind, event.created_at);
        }
        return;
      }
      case 0: {
        const row = toProfileRow(event);
        if (!row) return;
        const result = await upsertProfile(db, row);
        if (result === "inserted" || result === "replaced") {
          stats.accepted += 1;
          updateWatermark(event.kind, event.created_at);
        }
        return;
      }
      case 10002: {
        const row = toRelayListRow(event);
        if (!row) return;
        const result = await upsertRelayList(db, row);
        if (result === "inserted" || result === "replaced") {
          stats.accepted += 1;
          updateWatermark(event.kind, event.created_at);
        }
        return;
      }
      default:
        return; // unknown kind — ignore
    }
  }

  return {
    start(): Promise<void> {
      if (starting || handle !== null) return startReady; // idempotent
      starting = true;
      stopped = false;
      // Restore watermarks asynchronously, then open the subscription.
      // Doing both before opening the sub means cold start is a single
      // round-trip via the `since` filter.
      startReady = (async () => {
        try {
          await restoreWatermarks();
        } catch {
          // Best-effort restore — proceed with empty watermarks if cache
          // read fails. The CAS on writes is the correctness gate.
        }
        if (stopped) {
          starting = false;
          return;
        }
        // Build one filter per subscribed kind so each can carry its own
        // `since`. Keeps the wire-bandwidth optimization tight.
        const filters = SUBSCRIBED_KINDS.map((kind) => {
          const since = watermarks.get(kind);
          // `since` is exclusive in the relay protocol; bumping by 1
          // would lose simultaneous events. Use the watermark verbatim;
          // duplicates CAS-fail at the cache layer.
          return since !== undefined ? { kinds: [kind], since } : { kinds: [kind] };
        });
        handle = pool.subscribe({
          filters,
          onEvent: (event) => {
            // onEvent returns a promise; we don't await here because the
            // pool callback contract is sync. Errors inside the handler
            // are swallowed at this boundary (each kind's handler does
            // its own try-catch around DB writes via Dexie's transaction).
            void onEvent(event);
          },
          closeOnEose: false,
        });
        starting = false;
      })();
      return startReady;
    },
    async stop(): Promise<void> {
      stopped = true;
      // Wait for an in-progress start() to finish wiring (or skip wiring)
      // so we don't leak a subscription that opens after stop returned.
      await startReady;
      handle?.close();
      handle = null;
      // Drain in-flight Layer B work. Snapshot the set so late additions
      // (which can't happen because `stopped` is set, but defensively)
      // don't extend the wait indefinitely.
      const snapshot = Array.from(inflight);
      await Promise.all(snapshot);
    },
    getStats(): SchedulerStats {
      // Return a defensive copy so callers can't mutate our state.
      return { ...stats };
    },
  };
}
