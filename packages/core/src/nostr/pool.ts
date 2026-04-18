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
 * Extended with three audited secondary relays (nostr.mom 8 × k38172,
 * relay.nostr.wirednet.jp 4, relay.nostrplebs.com 2) to widen the Cashu
 * catch. The alchemist demo against the prior 5-relay seed found only 1
 * Cashu announcement on the wire — adding these pushes us past the
 * power-law knee documented in the audit (§3 cumulative table).
 *
 * relay.cashumints.space is the sole cashu-branded holdover — thin on event
 * count (only 4 historical events per audit) but part of the cashu
 * community's curated NIP-87 surface. relay.8333.space was dropped: the
 * audit reports a handshake timeout and classifies it as defunct despite
 * matching the audit.8333 domain.
 */
export const SEED_RELAYS: readonly string[] = [
  "wss://nos.lol",
  "wss://relay.damus.io",
  "wss://relay.primal.net",
  "wss://nostr.mom",
  "wss://relay.nostr.wirednet.jp",
  "wss://relay.nostrplebs.com",
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
  /**
   * Called once after all relays signal EOSE (or eoseTimeout fires). The
   * `relay` arg is the placeholder `"*"` because subscribeMany aggregates
   * EOSE across relays — the underlying API does not surface which relay
   * EOSE'd. Per-relay EOSE will require switching to per-relay subscribes
   * (deferred to PR #4).
   */
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
      // Hoisted before subscribeMany so the onevent/oneose closures below
      // can read it. handle.close() may resolve before the underlying
      // closer actually tears down the websocket subscription (the inner
      // closer awaits allOpened internally), so a late-arriving event
      // must be dropped at the wrapper boundary to honor the close
      // contract.
      let closed = false;
      const closers = opts.filters.map((filter) =>
        pool.subscribeMany(relays, filter, {
          onevent: (event: NostrEvent) => {
            if (closed) return;
            // nostr-tools doesn't expose the delivering relay on the event
            // directly in subscribeMany's onevent; use seenOn to look up
            // which relay(s) reported this event id.
            const seen = pool.seenOn.get(event.id);
            const firstRelay = seen?.values().next().value?.url;
            opts.onEvent(event, firstRelay ?? relays[0] ?? "");
          },
          oneose: opts.onEose
            ? () => {
                if (closed) return;
                // subscribeMany signals oneose once total (after all relays
                // EOSE, or eoseTimeout fires) without surfacing which relay
                // EOSE'd. Emit "*" as a placeholder so callers can still
                // observe the boundary between stored and live events.
                // TODO(PR #4): if per-relay EOSE is needed (e.g. for
                // single-slow-relay timeout handling), switch to
                // per-relay subscribes instead of subscribeMany.
                opts.onEose?.("*");
                if (opts.closeOnEose) {
                  closed = true;
                  for (const c of closers) c.close();
                }
              }
            : opts.closeOnEose
              ? () => {
                  if (closed) return;
                  closed = true;
                  for (const c of closers) c.close();
                }
              : undefined,
        }),
      );

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
