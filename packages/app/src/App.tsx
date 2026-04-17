import {
  BitcoinmintsDB,
  createMintInfoFetcher,
  createPool,
  createScheduler,
  type Scheduler,
  type SchedulerStats,
  SEED_RELAYS,
} from "@bitcoinmints/core";
import { type JSX, useEffect, useState } from "react";
import { MintList } from "./components/MintList";

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
const scheduler: Scheduler = createScheduler({
  db,
  pool,
  fetcher,
  relays: SEED_RELAYS,
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

  return (
    <div className="font-mono text-sm p-4 max-w-full">
      <div>scheduler stats</div>
      <pre>{JSON.stringify(stats, null, 2)}</pre>
      <hr />
      <MintList db={db} />
    </div>
  );
}
