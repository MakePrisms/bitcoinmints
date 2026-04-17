import type { Event as NostrEvent } from "nostr-tools/core";
import type { Filter } from "nostr-tools/filter";
import { SimplePool } from "nostr-tools/pool";

/**
 * Seed relay pool. Two of these (nos.lol + relay.damus.io) cover 98.4% of
 * all historical NIP-87 events per the empirical relay survey at
 * /srv/forge/projects/bitcoinmints/audit/relay-strategy-v1.md.
 *
 * relay.primal.net is included for:
 * - authorless kind-10002 lookups
 * - real-time live events (carries live traffic even when NIP-87 backlog is thin)
 */
export const SEED_RELAYS: readonly string[] = [
  "wss://nos.lol",
  "wss://relay.damus.io",
  "wss://relay.primal.net",
];

export type PoolConfig = {
  relays: string[];
};

export type SubscribeOptions = {
  /** One or more filters. Each filter is dispatched as its own subscription. */
  filters: Filter[];
  /** Called for each matching event; `relay` is the wss:// URL that delivered it. */
  onEvent: (event: NostrEvent, relay: string) => void;
  /** Called once per relay when end-of-stored-events is received. */
  onEose?: (relay: string) => void;
  /** If true, close the subscription after all relays signal EOSE. Default: false (live). */
  closeOnEose?: boolean;
};

export type PoolHandle = {
  /** Close all subscriptions created by this handle. Safe to call repeatedly. */
  close: () => void;
};

export type Pool = {
  /** Open a subscription across the configured relays for the given filters. */
  subscribe: (opts: SubscribeOptions) => PoolHandle;
  /** Close all relay connections managed by this pool. */
  close: () => void;
};

/**
 * Thin wrapper around nostr-tools SimplePool. Intentionally omits signer,
 * publish, and NIP-65 outbox logic — those are out of scope for the
 * read-only directory. See PR #2 scope notes for the reasoning.
 */
export function createPool(config: PoolConfig): Pool {
  const pool = new SimplePool();
  const relays = [...config.relays];

  return {
    subscribe(opts: SubscribeOptions): PoolHandle {
      const closers = opts.filters.map((filter) =>
        pool.subscribeMany(relays, filter, {
          onevent: (event: NostrEvent) => {
            // nostr-tools doesn't expose the delivering relay on the event
            // directly in subscribeMany's onevent; use seenOn to look up
            // which relay(s) reported this event id.
            const seen = pool.seenOn.get(event.id);
            const firstRelay = seen?.values().next().value?.url;
            opts.onEvent(event, firstRelay ?? relays[0] ?? "");
          },
          oneose: opts.onEose
            ? () => {
                // subscribeMany signals oneose once after all relays EOSE
                // (the relay URL is not provided — we emit a placeholder).
                opts.onEose?.("*");
                if (opts.closeOnEose) {
                  for (const c of closers) c.close();
                }
              }
            : opts.closeOnEose
              ? () => {
                  for (const c of closers) c.close();
                }
              : undefined,
        }),
      );

      let closed = false;
      return {
        close() {
          if (closed) return;
          closed = true;
          for (const c of closers) c.close();
        },
      };
    },
    close() {
      pool.close(relays);
    },
  };
}
