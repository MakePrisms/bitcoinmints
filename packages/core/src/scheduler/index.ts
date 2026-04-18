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

import Dexie from "dexie";
import type { Event as NostrEvent } from "nostr-tools/core";
import {
  type AnnouncementRow,
  type BitcoinmintsDB,
  type ProfileRow,
  type RelayListRow,
  upsertAnnouncement,
  upsertMintInfo,
  upsertProfile,
  upsertRelayList,
} from "../cache";
import type { MintInfoFetcher } from "../cashu/info";
import { type LayerBResult, verifySignerBinding } from "../cashu/layerB";
import { type MintAnnouncement, parseMintAnnouncement } from "../nip87";
import type { Pool, PoolHandle } from "../nostr";
import { parseReview } from "../reviews/parse";
import { upsertReviewWithAggregate } from "../reviews/upsert";

/** Observable counters surfaced via getStats() — for the UI in PR #6+. */
export type SchedulerStats = {
  eventsReceived: number;
  accepted: number;
  rejectedByLayerA: number;
  /**
   * kind:38000 reviews that were dropped because `parseReview` returned
   * `null` — either the `d` tag was missing/empty or the event was
   * unexpectedly not kind:38000. Counted separately from `rejectedByLayerA`
   * because it's a parser-level reject (malformed event) rather than a
   * shape-gate reject (valid event pointing at bot-spam).
   */
  rejectedByParse: number;
  layerBPending: number;
  layerBVerified: number;
  layerBFailed: number;
  /**
   * Count of exceptions thrown out of the per-event handler after we've
   * started processing. A thrown Dexie transaction (QuotaExceeded, schema
   * collision, unexpected disk state) or any other unhandled error in a
   * kind-specific branch bumps this counter — without it, the error would
   * become an unhandled promise rejection and the stats would silently
   * freeze at last-good while ingest continued to look healthy.
   */
  handlerErrors: number;
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
  /**
   * Opt-in per-event debug logging. Default `false` — zero perf cost when
   * off (no allocations, no logs).
   *
   * When `true`, logs through `console.log` / `console.warn` with the
   * stable `[scheduler]` prefix:
   *   - on start(): the filters array being sent to relays + the configured
   *     relay list
   *   - per event (after the switch branch resolves): kind, id prefix,
   *     delivering relay, and the resolved path (accepted / rejected-*
   *     / dropped / replaced)
   *   - per Layer B resolution: kind/id/url + verdict (verified /
   *     failed:<reason> / transient)
   *
   * Keep the surface console-only — no structured logger is wired through
   * the package. Intended as a demo/X-ray aid, not production telemetry.
   */
  debug?: boolean;
};

/** NIP-87 + supporting kinds. See data-model-v1.md §1 for the full list. */
const SUBSCRIBED_KINDS = [38172, 38173, 38000, 0, 10002] as const;

/**
 * Expose the subscribed kinds tuple for UI consumers that want to render
 * "filters in use" without duplicating the literal. Frozen through
 * `as const` in the declaration above, so callers cannot mutate the
 * underlying array.
 */
export function getSubscribedKinds(): readonly number[] {
  return SUBSCRIBED_KINDS;
}

/** Initial backoff window for a failed mint URL: attempts=0 → 30s. */
const BASE_BACKOFF_MS = 30_000;
/** Cap at 1 hour. */
const MAX_BACKOFF_MS = 60 * 60_000;

/**
 * How far into the future a relay event's `created_at` is allowed to advance
 * the watermark. Wallets with skewed clocks emit events a few minutes ahead;
 * a malicious or buggy event with `created_at` in the year 3000 would
 * otherwise poison the in-memory watermark and silently filter all
 * subsequent legitimate events on the wire (see gap #19 / silent-failure
 * analysis). 10 minutes is the standard NIP-01 clock-skew tolerance.
 */
const WATERMARK_FUTURE_SLACK_SEC = 600;

/**
 * Hard ceiling on a single Layer B verification attempt. The fetcher's
 * per-URL timeout is 5s; with up to ~3 URLs and a touch of slack for
 * transaction overhead, 30s is the wall-clock budget. Past this, the task
 * is treated as a transient failure (verifiedBySignerBinding stays null
 * for retry) so a stuck mint can't pin a worker.
 */
const LAYER_B_TASK_TIMEOUT_MS = 30_000;

/**
 * Max number of unverified rows we re-enqueue at startup to avoid restart
 * storms when a long-down mint comes back. The remainder will be picked up
 * by the regular onEvent path on the next replay or via a future periodic
 * sweep (deferred).
 */
const RESTART_REENQUEUE_CAP = 100;

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
  const debug = config.debug ?? false;

  const stats: SchedulerStats = {
    eventsReceived: 0,
    accepted: 0,
    rejectedByLayerA: 0,
    rejectedByParse: 0,
    layerBPending: 0,
    layerBVerified: 0,
    layerBFailed: 0,
    handlerErrors: 0,
  };

  // Tracks (kind -> highest createdAt seen). Used to compute the `since`
  // filter on next start(). Not persisted — the cache is the durable
  // record and we re-derive on restart.
  const watermarks = new Map<number, number>();
  /**
   * Advance the in-memory watermark for a kind, clamping to
   * `now + WATERMARK_FUTURE_SLACK_SEC`. The clamp prevents a junk event
   * with `created_at` far in the future from poisoning the watermark — if
   * we trust it verbatim, that watermark would persist (via re-derivation
   * from `max(createdAt)` on restart) and silently filter all subsequent
   * legitimate events that arrive with a smaller `created_at`.
   */
  const updateWatermark = (kind: number, createdAt: number) => {
    const safeTs = Math.min(createdAt, Math.floor(now() / 1000) + WATERMARK_FUTURE_SLACK_SEC);
    const prev = watermarks.get(kind) ?? 0;
    if (safeTs > prev) watermarks.set(kind, safeTs);
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
   *
   * Uses the v2 compound index `[kind+createdAt]` on announcements so the
   * per-kind lookup is bounded (`.last()` of a range scan) rather than
   * materializing the whole table via .sortBy(). The restored value is
   * fed through `updateWatermark` which applies the future-slack clamp,
   * so a poisoned event in the cache can't re-poison the in-memory
   * watermark on restart.
   */
  async function restoreWatermarks(): Promise<void> {
    // Announcements: 38172 + 38173 — bounded scan via compound index.
    for (const k of [38172, 38173] as const) {
      const last = await db.announcements
        .where("[kind+createdAt]")
        .between([k, Dexie.minKey], [k, Dexie.maxKey])
        .last();
      if (last) updateWatermark(k, last.createdAt);
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
   * On startup, find announcements that were accepted but never had Layer B
   * complete (verifiedBySignerBinding === null) and re-enqueue them. Without
   * this, a row that was inserted before a Layer B failure (or before a
   * crash) sits in the cache forever as "not yet verified" and the UI
   * shows no badge. Capped at RESTART_REENQUEUE_CAP to avoid restart storms
   * if a long-down mint comes back. Only kinds 38172 (Cashu) qualify —
   * 38173 (Fedimint) has no Layer B by design.
   *
   * We collect the candidate rows under a READ transaction first, then
   * enqueue them OUTSIDE that transaction. Calling enqueueLayerB while
   * still inside the .each() callback would schedule runLayerB's `rw`
   * transaction as a child of Dexie's currently-open `r` transaction
   * (Dexie auto-binds via zone-tracked promise chains), which fails with
   * SubTransactionError.
   */
  async function reenqueueUnverified(): Promise<void> {
    const candidates: AnnouncementRow[] = [];
    let truncated = false;
    await db.announcements
      .where("kind")
      .anyOf([38172])
      .filter((r) => r.verifiedBySignerBinding === null)
      .until(() => candidates.length >= RESTART_REENQUEUE_CAP)
      .each((row) => {
        if (candidates.length >= RESTART_REENQUEUE_CAP) {
          truncated = true;
          return;
        }
        candidates.push(row);
      });
    // Outside the transaction now — safe to start `rw` work.
    for (const row of candidates) enqueueLayerB(row);
    if (truncated) {
      // Best-effort signal to operators that the cap kicked in. console
      // is the right surface here — we don't have a structured logger
      // wired through yet (deferred to ingest-stats UI work).
      console.warn(
        `[scheduler] reenqueueUnverified hit RESTART_REENQUEUE_CAP=${RESTART_REENQUEUE_CAP}; remaining unverified rows will be retried on next replay`,
      );
    }
  }

  /**
   * Map a LayerBResult to the value we persist on the announcement row.
   *
   *   - verified=true                       → true   (real positive verdict)
   *   - verified=false, all-fetches-failed  → null   (transient — re-try later)
   *   - verified=false, no-signer-source    → null   (transient — mint exposes
   *                                                   no usable signer source;
   *                                                   genuinely unverifiable
   *                                                   per P0.1 / P0.2)
   *   - verified=false, pubkey-mismatch     → false  (real negative verdict)
   *   - verified=false, anything else       → null   (defensive — treat as transient)
   *
   * Without this mapping, a transient `all-fetches-failed` would write
   * `verifiedBySignerBinding: false` and the row would carry a permanent
   * negative verdict for what was actually just a temporary network issue
   * (silent-failure gap).
   */
  function verdictForPersistence(result: LayerBResult): boolean | null {
    if (result.verified) return true;
    // Treat pubkey-mismatch as a real verdict; everything else is transient.
    if (typeof result.reason === "string" && result.reason.startsWith("pubkey-mismatch")) {
      return false;
    }
    return null;
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
      // Per-task timeout: cap the total wall-clock for one Layer B attempt.
      // The fetcher has a per-URL timeout (5s default), but a row with
      // many URLs or a fetcher that gets stuck on a single hung promise
      // could still pin a worker indefinitely. On timeout we map to
      // `all-fetches-failed` so the row stays null/transient and gets
      // retried later (verdictForPersistence above).
      result = await Promise.race<LayerBResult>([
        verifySignerBinding(row, fetcher),
        new Promise<LayerBResult>((_, reject) => {
          setTimeout(() => reject(new Error("layer-b-timeout")), LAYER_B_TASK_TIMEOUT_MS);
        }),
      ]);
    } catch (err) {
      // Either a thrown verifier (defensive — verifySignerBinding shouldn't
      // throw given the fetcher contract) or our timeout. Either way, we
      // treat it as a transient failure so the row gets retried.
      const message = err instanceof Error ? err.message : String(err);
      const reason =
        message === "layer-b-timeout" ? "all-fetches-failed" : `verifier-threw: ${message}`;
      result = { verified: false, reason };
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

    const verdict = verdictForPersistence(result);
    // The matched URL — present only on success — is what we write into
    // MintInfoRow. On failure we fall back to u[0] for the diagnostic row
    // (the UI uses it as a label, no further fetches happen against it).
    const persistedUrl = result.verified ? result.url : (row.u[0] ?? "");

    // Persist verification result on the announcement row in a transaction
    // that re-checks the row's eventId before writing. This prevents a
    // newer event that landed mid-Layer-B from being clobbered by a
    // stale spread of the snapshot we read before the verify started.
    //
    // Race shape we're guarding against (gap #22):
    //   1. We read `existing` at createdAt=100.
    //   2. onEvent fires for a newer event at createdAt=200, upsert
    //      replaces the row.
    //   3. We `put({ ...existing, verifiedBySignerBinding })`, which
    //      re-spreads the createdAt=100 snapshot and clobbers the
    //      newer row.
    //
    // Inside the transaction we re-fetch and assert `existing.eventId`
    // still matches `row.eventId`. If it doesn't, the row was replaced
    // mid-flight; we drop both the announcement update AND the MintInfoRow
    // upsert (the new row will be re-enqueued by onEvent's normal accept
    // path).
    let didPersistAnnouncement = false;
    await db.transaction("rw", db.announcements, async () => {
      const current = await db.announcements.get([row.pubkey, row.kind, row.d]);
      if (!current) return;
      if (current.eventId !== row.eventId) {
        // A newer event raced past us. Don't clobber it — drop the
        // verification result. The replacement will get its own Layer B
        // pass via the normal onEvent path.
        return;
      }
      // Write only the field we own. No `...current` spread — we're not
      // shipping a stale snapshot of fields we don't intend to change,
      // and that means future field additions don't risk silent regression.
      await db.announcements.update([row.pubkey, row.kind, row.d], {
        verifiedBySignerBinding: verdict,
      });
      didPersistAnnouncement = true;
    });

    // Persist /v1/info into the mintInfo table. Only do this if the
    // announcement update went through (i.e. this Layer B pass was for
    // the row that's still current). upsertMintInfo opens its own
    // transaction, so it must run outside the announcement-only tx
    // above (Dexie disallows promoting a sub-transaction to a different
    // table list). The MintInfoRow CAS predicate is fetchedAt, so even
    // if a newer Layer B pass races us here, the higher fetchedAt wins.
    if (didPersistAnnouncement) {
      if (result.verified) {
        await upsertMintInfo(db, {
          d: row.d,
          url: persistedUrl,
          fetchedAt: now(),
          infoJson: result.info as unknown as Record<string, unknown>,
          ok: true,
        });
      } else {
        // Failure case: write a !ok row so the UI can show a "verification
        // failed: $reason" badge without re-running Layer B itself.
        await upsertMintInfo(db, {
          d: row.d,
          url: persistedUrl,
          fetchedAt: now(),
          infoJson: {},
          ok: false,
          lastError: result.reason ?? "unknown",
        });
      }
    }

    if (result.verified) {
      stats.layerBVerified += 1;
    } else {
      stats.layerBFailed += 1;
    }

    if (debug) {
      // Verdict mirrors `verdictForPersistence` shape: verified=true →
      // verified; pubkey-mismatch → failed:<reason>; anything else →
      // transient (the row stays null and will be retried).
      let verdict: string;
      if (result.verified) {
        verdict = "verified";
      } else if (typeof result.reason === "string" && result.reason.startsWith("pubkey-mismatch")) {
        verdict = `failed:${result.reason}`;
      } else {
        verdict = `transient:${result.reason ?? "unknown"}`;
      }
      console.log(
        `[scheduler] layerB kind=38172 id=${row.eventId.slice(0, 8)} url=${persistedUrl} verdict=${verdict}`,
      );
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

  /**
   * Per-event handler — single funnel for all kinds.
   *
   * Each case body is wrapped in its own try/catch so a thrown Dexie
   * transaction (QuotaExceeded, schema collision, unexpected disk state)
   * or any other branch-local exception gets counted into
   * `stats.handlerErrors` and logged with a stable prefix. Without the
   * wrappers, the rejection would escape the `void onEvent(event)` call
   * at the subscription boundary and stats would silently freeze at
   * last-good while ingest continued to look healthy (silent-failure
   * gap). Log surface matches `reenqueueUnverified`'s existing pattern:
   * a `[scheduler]`-prefixed console call, no structured logger is wired
   * through the package yet.
   *
   * `relay` is the wss:// URL that delivered the event, threaded through
   * from the pool's `onEvent(event, relay)` callback purely so the
   * opt-in debug log line can include it. It is NOT otherwise used by
   * the scheduler (single global watermark, no per-relay bookkeeping).
   */
  // path labels for the debug per-event line. Kept narrow so we can't
  // typo a path name and have it silently fall through.
  type EventPath = "accepted" | "rejected-layerA" | "rejected-parse" | "dropped" | "replaced";
  const logPath = (kind: number, eventId: string, relay: string, path: EventPath): void => {
    if (!debug) return;
    console.log(`[scheduler] kind=${kind} id=${eventId.slice(0, 8)} relay=${relay} path=${path}`);
  };
  async function onEvent(event: NostrEvent, relay: string): Promise<void> {
    if (stopped) return;
    stats.eventsReceived += 1;

    switch (event.kind) {
      case 38172:
      case 38173: {
        try {
          const parsed = parseMintAnnouncement(event);
          if (!parsed) {
            logPath(event.kind, event.id, relay, "dropped");
            return;
          }
          const row = toAnnouncementRow(parsed);
          const result = await upsertAnnouncement(db, row);
          if (result === "rejected-invalid") {
            stats.rejectedByLayerA += 1;
            logPath(event.kind, event.id, relay, "rejected-layerA");
            return;
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
            logPath(event.kind, event.id, relay, result === "replaced" ? "replaced" : "accepted");
            return;
          }
          // rejected-stale or any other terminal upsert result: count as
          // a drop so the trace doesn't go silent on duplicates.
          logPath(event.kind, event.id, relay, "dropped");
        } catch (err) {
          stats.handlerErrors += 1;
          console.error("[scheduler] handler error", {
            kind: event.kind,
            eventId: event.id,
            err,
          });
        }
        return;
      }
      case 38000: {
        try {
          // PR #5: parse via reviews/parseReview (all 4 rating formats +
          // null fallback) and route through the aggregate-materializing
          // upsert wrapper so the mintAggregate row stays in sync inside
          // the same Dexie transaction as the review write.
          const row = parseReview(event);
          if (!row) {
            // parseReview returns null for missing/empty `d` or wrong kind
            // — neither should reach here in a healthy pipeline but both
            // are silent drops worth counting (silent-failure gap).
            stats.rejectedByParse += 1;
            logPath(event.kind, event.id, relay, "rejected-parse");
            return;
          }
          const result = await upsertReviewWithAggregate(db, row, now);
          if (result === "inserted" || result === "replaced") {
            stats.accepted += 1;
            updateWatermark(event.kind, event.created_at);
            logPath(event.kind, event.id, relay, result === "replaced" ? "replaced" : "accepted");
          } else if (result === "rejected-invalid") {
            // Layer A gate on reviews: pointing at a bot-spam d-tag. Count
            // under the same stats bucket as the announcement Layer A
            // rejection — it's the same firewall.
            stats.rejectedByLayerA += 1;
            logPath(event.kind, event.id, relay, "rejected-layerA");
          } else {
            logPath(event.kind, event.id, relay, "dropped");
          }
        } catch (err) {
          stats.handlerErrors += 1;
          console.error("[scheduler] handler error", {
            kind: event.kind,
            eventId: event.id,
            err,
          });
        }
        return;
      }
      case 0: {
        try {
          const row = toProfileRow(event);
          if (!row) {
            logPath(event.kind, event.id, relay, "dropped");
            return;
          }
          const result = await upsertProfile(db, row);
          if (result === "inserted" || result === "replaced") {
            stats.accepted += 1;
            updateWatermark(event.kind, event.created_at);
            logPath(event.kind, event.id, relay, result === "replaced" ? "replaced" : "accepted");
          } else {
            logPath(event.kind, event.id, relay, "dropped");
          }
        } catch (err) {
          stats.handlerErrors += 1;
          console.error("[scheduler] handler error", {
            kind: event.kind,
            eventId: event.id,
            err,
          });
        }
        return;
      }
      case 10002: {
        try {
          const row = toRelayListRow(event);
          if (!row) {
            logPath(event.kind, event.id, relay, "dropped");
            return;
          }
          const result = await upsertRelayList(db, row);
          if (result === "inserted" || result === "replaced") {
            stats.accepted += 1;
            updateWatermark(event.kind, event.created_at);
            logPath(event.kind, event.id, relay, result === "replaced" ? "replaced" : "accepted");
          } else {
            logPath(event.kind, event.id, relay, "dropped");
          }
        } catch (err) {
          stats.handlerErrors += 1;
          console.error("[scheduler] handler error", {
            kind: event.kind,
            eventId: event.id,
            err,
          });
        }
        return;
      }
      default:
        logPath(event.kind, event.id, relay, "dropped");
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
        // Re-enqueue rows that were accepted but never had Layer B
        // complete (e.g. because the previous run crashed mid-fetch or a
        // mint was down at the time). Without this, the row sits in the
        // cache forever as "not yet verified" — the UI shows no badge and
        // we never re-try.
        try {
          await reenqueueUnverified();
        } catch {
          // Best-effort — same rationale as the watermark restore above.
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
        if (debug) {
          console.log(
            `[scheduler] start — filters=${JSON.stringify(filters)} relays=${JSON.stringify(config.relays)}`,
          );
        }
        handle = pool.subscribe({
          filters,
          onEvent: (event, relay) => {
            // onEvent returns a promise; we don't await here because the
            // pool callback contract is sync. Each kind's case body wraps
            // its own try/catch that counts into stats.handlerErrors, so
            // a thrown Dexie transaction can't escape as an unhandled
            // rejection or silently freeze the stats.
            void onEvent(event, relay);
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
