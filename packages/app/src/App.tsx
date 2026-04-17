import {
  BitcoinmintsDB,
  createMintInfoFetcher,
  createPool,
  createScheduler,
  getSubscribedKinds,
  type Scheduler,
  type SchedulerStats,
  SEED_RELAYS,
} from "@bitcoinmints/core";
import { type JSX, useEffect, useState } from "react";
import { MintList } from "./components/MintList";

/**
 * Human labels for each subscribed kind, aligned with the validation-paths
 * table below. The "firehose — no authors" annotation on kinds 0 and 10002
 * matches PR #30's review callout: we subscribe without an `authors`
 * restriction, so those filters are fundamentally unbounded. Visible in the
 * X-ray so the demo doesn't need a footnote.
 */
const KIND_LABELS: Record<number, string> = {
  38172: "cashu announcements",
  38173: "fedimint announcements",
  38000: "reviews",
  0: "profiles (firehose — no authors)",
  10002: "relay lists (firehose — no authors)",
};

/**
 * The one and only route. No router: a single `/` view dumping everything
 * Dexie has.
 *
 * Boot discipline:
 *   - db + pool + fetcher + scheduler are created exactly once at module
 *     load (outside the component) so React 19 StrictMode's double-invoke
 *     of effects in dev can't produce two schedulers fighting over the
 *     same Dexie. The effect body then does `scheduler.start()` on every
 *     mount and `scheduler.stop()` on every cleanup — the scheduler is
 *     idempotent across those calls (start resets `stopped`, stop drains
 *     in-flight Layer B work), so StrictMode's double-invoke produces
 *     start → stop → start exactly as intended rather than leaving us
 *     stuck after the first cleanup.
 *
 * Stats refresh:
 *   - getStats() returns a plain snapshot; we poll it on a 500ms ticker so
 *     the `<pre>` at the top advances even when Dexie writes are quiet (the
 *     Dexie-triggered `useLiveQuery` in MintList would otherwise be the
 *     only re-render driver, and it only fires on row changes — not when
 *     `eventsReceived` increments without a write).
 */
const db = new BitcoinmintsDB();
const pool = createPool({ relays: [...SEED_RELAYS] });
const fetcher = createMintInfoFetcher({ concurrency: 4 });
/**
 * Debug logging is a demo/X-ray aid, toggled via `?debug` on the URL (any
 * presence wins; no value parsing). When enabled, the scheduler logs its
 * filters/relays on start(), a per-event path line, and a per-Layer-B
 * verdict line — all through `console.log`/`console.warn` with the
 * `[scheduler]` prefix. Deliberately URL-toggled (not env-baked) so an
 * alchemist can flip it on during a live demo without rebuilding.
 */
const DEBUG_SCHEDULER =
  typeof window !== "undefined" && new URLSearchParams(window.location.search).has("debug");
const scheduler: Scheduler = createScheduler({
  db,
  pool,
  fetcher,
  relays: SEED_RELAYS,
  debug: DEBUG_SCHEDULER,
});

const STATS_POLL_MS = 500;

export function App(): JSX.Element {
  const [stats, setStats] = useState<SchedulerStats>(scheduler.getStats());

  useEffect(() => {
    void scheduler.start();
    const handle = window.setInterval(() => {
      setStats(scheduler.getStats());
    }, STATS_POLL_MS);
    return () => {
      window.clearInterval(handle);
      // Fire-and-forget stop(): app unmount means page navigation away or
      // dev-HMR, either way we want the subscription closed. We don't await
      // because React's effect-cleanup contract is synchronous.
      void scheduler.stop();
    };
  }, []);

  // Static derivations for the X-ray — computed once per render, but the
  // inputs are module-constants so React's reconciler is effectively a
  // no-op on these blocks.
  const kinds = getSubscribedKinds();
  // The widest kind label is 5 chars (e.g. "38172"). Pad to align.
  const filtersBlock = kinds
    .map((k) => {
      const label = KIND_LABELS[k] ?? "";
      const padded = `{ kinds: [${String(k).padEnd(5, " ")}] }`;
      return `  ${padded}     ${label}`;
    })
    .join("\n");
  const relaysBlock = SEED_RELAYS.map((r) => `  ${r}`).join("\n");

  return (
    <div className="font-mono text-sm p-4 max-w-full">
      <div>scheduler stats</div>
      <pre>{JSON.stringify(stats, null, 2)}</pre>
      {/*
        Counter note: all scheduler stats are monotonically increasing
        EXCEPT `layerBPending`, which is transient — it goes up on
        enqueue and back down when Layer B completes. The alchemist
        observed it "going up then down" during the prior demo; this
        comment exists so the next viewer doesn't flag it as a bug.
      */}
      <div>counters: monotonic, except layerBPending (transient: enqueue↑ / complete↓)</div>

      <hr />
      <div>filters in use</div>
      <pre>{filtersBlock}</pre>
      <div>relays</div>
      <pre>{relaysBlock}</pre>

      <hr />
      <div>validation paths</div>
      <pre>{VALIDATION_PATHS_TABLE}</pre>

      <hr />
      <MintList db={db} />
    </div>
  );
}

/**
 * Reference doc rendered in the X-ray — the kind → parser → gate → counter
 * path for every subscribed kind. Kept as a plain string (not a React
 * table) so it stays font-mono and terse alongside the other `<pre>`
 * blocks. Source of truth: scheduler/index.ts:onEvent switch.
 *
 * Hand-aligned fixed-width columns — edit with care. If a column grows
 * past its width, widen the whole column rather than wrapping mid-row.
 */
const VALIDATION_PATHS_TABLE = `
kind           parser                       Layer A gate                         Layer B                               counters
─────          ──────                       ────────────                         ───────                               ────────
38172 cashu    parseMintAnnouncement        upsertAnnouncement d-tag + spam      verifySignerBinding /v1/info ×        parse-null → drop
               (needs d + ≥1 u)             check                                pubkey match                          rejected → rejectedByLayerA
                                                                                                                       accepted → accepted + layerBPending

38173 fedimint parseMintAnnouncement        upsertAnnouncement d-tag + spam      none                                  same as 38172 minus Layer B
               (needs d + ≥1 u)             check

38000 review   parseReview                  upsertReviewWithAggregate d-tag      none                                  parse-null → rejectedByParse
                                            check                                                                      rejected → rejectedByLayerA
                                                                                                                       accepted → accepted

0 profile      toProfileRow                 upsertProfile                        none                                  null → drop
                                                                                                                       accepted → accepted

10002 relay    toRelayListRow               upsertRelayList                      none                                  same as kind 0
list
`;
