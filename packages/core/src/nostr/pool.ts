import type { Event as NostrEvent } from "nostr-tools/core";
import type { Filter } from "nostr-tools/filter";
import { SimplePool } from "nostr-tools/pool";

/**
 * Seed relay pool. The first three (nos.lol, relay.damus.io, relay.primal.net)
 * are the ecosystem-consensus top 3 from an implementor-default survey across
 * cashu.me, bitpoints.me, cashumints.space site, cashu-mint-page, and the
 * current bitcoinmints main. Damus 6/6, nos.lol 5/6, primal 4/6. Empirically,
 * nos.lol + damus alone carry 98.4% of all historical NIP-87 events per
 * /srv/forge/projects/bitcoinmints/audit/relay-strategy-v1.md.
 *
 * relay.8333.space + relay.cashumints.space are cashu-branded relays included
 * for ecosystem citizenship — thin on event count but part of the cashu
 * community's curated NIP-87 surface (8333 is cashu.me's extra default;
 * cashumints.space appears in 2/6 implementor defaults).
 */
export const SEED_RELAYS: readonly string[] = [
  "wss://nos.lol",
  "wss://relay.damus.io",
  "wss://relay.primal.net",
  "wss://relay.8333.space",
  "wss://relay.cashumints.space",
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
  // nostr-tools 2.23.3 ships with trackRelays defaulting to false, which
  // means pool.seenOn never gets populated and our event-routing falls back
  // to relays[0] for every event. Flip it on so seenOn actually reflects
  // which relay delivered each event.
  pool.trackRelays = true;
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
