import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock nostr-tools SimplePool at module load. Each pool.subscribeMany
// returns a closer we can spy on; pool.close() collects calls for inspection.
const subscribeManyMock = vi.fn();
const closeMock = vi.fn();
const seenOnMock = new Map<string, Set<{ url: string }>>();
const constructedPools: Array<{ trackRelays: boolean }> = [];

vi.mock("nostr-tools/pool", () => {
  return {
    SimplePool: class {
      // Mirror nostr-tools 2.23.3 default: trackRelays starts false and
      // must be flipped on by the caller for seenOn to populate.
      trackRelays = false;
      seenOn = seenOnMock;
      constructor() {
        constructedPools.push(this);
      }
      subscribeMany(...args: unknown[]) {
        return subscribeManyMock(...args);
      }
      close(...args: unknown[]) {
        return closeMock(...args);
      }
    },
  };
});

// Import after the mock is registered.
import { createPool, SEED_RELAYS } from "./pool";

describe("SEED_RELAYS", () => {
  it("exports exactly the five-relay default seed pool from the spec", () => {
    // Top 3 are the ecosystem-consensus NIP-87 implementor defaults
    // (damus 6/6, nos.lol 5/6, primal 4/6 across 6 surveyed hardcoders).
    // Last 2 are cashu-branded relays — thin on event count but part of the
    // cashu community's curated NIP-87 surface.
    expect(SEED_RELAYS).toEqual([
      "wss://nos.lol",
      "wss://relay.damus.io",
      "wss://relay.primal.net",
      "wss://relay.8333.space",
      "wss://relay.cashumints.space",
    ]);
  });
});

describe("createPool", () => {
  beforeEach(() => {
    subscribeManyMock.mockReset();
    closeMock.mockReset();
    seenOnMock.clear();
    constructedPools.length = 0;
  });

  it("flips trackRelays=true on the underlying SimplePool so seenOn populates", () => {
    // nostr-tools 2.23.3 defaults trackRelays to false, which silently
    // disables seenOn. Without this flip every event would fall back to
    // relays[0] and be misattributed. Regression guard for the bug found
    // in PR #28 review.
    createPool({ relays: [...SEED_RELAYS] });
    expect(constructedPools).toHaveLength(1);
    expect(constructedPools[0]?.trackRelays).toBe(true);
  });

  it("returns a pool with subscribe() and close()", () => {
    const pool = createPool({ relays: [...SEED_RELAYS] });
    expect(typeof pool.subscribe).toBe("function");
    expect(typeof pool.close).toBe("function");
  });

  it("subscribe() returns a handle with close(); does not hit live relays", () => {
    const innerCloser = { close: vi.fn() };
    subscribeManyMock.mockReturnValue(innerCloser);

    const pool = createPool({ relays: [...SEED_RELAYS] });
    const handle = pool.subscribe({
      filters: [{ kinds: [38172] }],
      onEvent: () => {},
    });

    expect(typeof handle.close).toBe("function");
    expect(subscribeManyMock).toHaveBeenCalledTimes(1);
    expect(subscribeManyMock.mock.calls[0]?.[0]).toEqual([...SEED_RELAYS]);
    expect(subscribeManyMock.mock.calls[0]?.[1]).toEqual({ kinds: [38172] });

    handle.close();
    expect(innerCloser.close).toHaveBeenCalledTimes(1);

    // Double-close is safe.
    handle.close();
    expect(innerCloser.close).toHaveBeenCalledTimes(1);
  });

  it("dispatches one subscription per filter entry", () => {
    subscribeManyMock.mockReturnValue({ close: vi.fn() });

    const pool = createPool({ relays: ["wss://example.test"] });
    pool.subscribe({
      filters: [{ kinds: [38172] }, { kinds: [38173] }, { kinds: [38000] }],
      onEvent: () => {},
    });

    expect(subscribeManyMock).toHaveBeenCalledTimes(3);
  });

  it("forwards events from subscribeMany's onevent to user callback with a relay url", () => {
    let capturedOnevent: ((e: unknown) => void) | undefined;
    subscribeManyMock.mockImplementation(
      (_relays: string[], _filter: unknown, params: { onevent: (e: unknown) => void }) => {
        capturedOnevent = params.onevent;
        return { close: () => {} };
      },
    );

    const received: Array<{ eventId: string; relay: string }> = [];
    const pool = createPool({ relays: ["wss://a.test", "wss://b.test"] });
    pool.subscribe({
      filters: [{ kinds: [38000] }],
      onEvent: (event, relay) => received.push({ eventId: event.id, relay }),
    });

    // Simulate an event delivery. seenOn maps event id -> set of relay-like objects.
    const evt = {
      id: "abc",
      pubkey: "pk",
      created_at: 1,
      kind: 38000,
      tags: [],
      content: "",
      sig: "",
    };
    seenOnMock.set("abc", new Set([{ url: "wss://a.test" }]));
    capturedOnevent?.(evt);

    expect(received).toHaveLength(1);
    expect(received[0]?.eventId).toBe("abc");
    expect(received[0]?.relay).toBe("wss://a.test");
  });

  it("drops events delivered after handle.close() (post-close gating)", () => {
    // The inner closer awaits allOpened internally before tearing down
    // the websocket subscription, so events can race past handle.close().
    // Wrapper must gate at the boundary so callers see clean shutdown.
    let capturedOnevent: ((e: unknown) => void) | undefined;
    subscribeManyMock.mockImplementation(
      (_relays: string[], _filter: unknown, params: { onevent: (e: unknown) => void }) => {
        capturedOnevent = params.onevent;
        return { close: () => {} };
      },
    );

    const received: string[] = [];
    const pool = createPool({ relays: ["wss://a.test"] });
    const handle = pool.subscribe({
      filters: [{ kinds: [38000] }],
      onEvent: (event) => received.push(event.id),
    });

    const evt = (id: string) => ({
      id,
      pubkey: "pk",
      created_at: 1,
      kind: 38000,
      tags: [],
      content: "",
      sig: "",
    });

    seenOnMock.set("before", new Set([{ url: "wss://a.test" }]));
    capturedOnevent?.(evt("before"));
    expect(received).toEqual(["before"]);

    handle.close();

    // Late delivery from the still-tearing-down subscription. Should be
    // silently dropped.
    seenOnMock.set("after", new Set([{ url: "wss://a.test" }]));
    capturedOnevent?.(evt("after"));
    expect(received).toEqual(["before"]);
  });

  it("fires onEose once with the '*' placeholder (subscribeMany aggregates EOSE)", () => {
    // subscribeMany emits a single oneose after all relays EOSE without
    // surfacing which relay EOSE'd. Our wrapper documents this by passing
    // "*" — callers must not assume one-call-per-relay semantics.
    let capturedOneose: (() => void) | undefined;
    subscribeManyMock.mockImplementation(
      (_relays: string[], _filter: unknown, params: { oneose?: () => void }) => {
        capturedOneose = params.oneose;
        return { close: () => {} };
      },
    );

    const eoseRelays: string[] = [];
    const pool = createPool({ relays: ["wss://a.test", "wss://b.test"] });
    pool.subscribe({
      filters: [{ kinds: [38000] }],
      onEvent: () => {},
      onEose: (relay) => eoseRelays.push(relay),
    });

    capturedOneose?.();
    expect(eoseRelays).toEqual(["*"]);

    // A second oneose tick (e.g. duplicate fire) would still report "*"
    // — this is contract, not bug.
    capturedOneose?.();
    expect(eoseRelays).toEqual(["*", "*"]);
  });

  it("close() forwards the configured relay list to SimplePool.close", () => {
    subscribeManyMock.mockReturnValue({ close: vi.fn() });

    const relays = ["wss://one.test", "wss://two.test"];
    const pool = createPool({ relays });
    pool.close();

    expect(closeMock).toHaveBeenCalledTimes(1);
    expect(closeMock.mock.calls[0]?.[0]).toEqual(relays);
  });

  it("does not mutate the caller's relay array", () => {
    subscribeManyMock.mockReturnValue({ close: vi.fn() });

    const relays = ["wss://one.test"];
    const pool = createPool({ relays });
    relays.push("wss://mutated.test");
    pool.subscribe({ filters: [{ kinds: [1] }], onEvent: () => {} });

    // First call should have used the original single-entry list.
    expect(subscribeManyMock.mock.calls[0]?.[0]).toEqual(["wss://one.test"]);
  });

  it("subscribe() with an empty filter array is a no-op (no subscribeMany, close is safe)", () => {
    subscribeManyMock.mockReturnValue({ close: vi.fn() });

    const pool = createPool({ relays: [...SEED_RELAYS] });
    const handle = pool.subscribe({ filters: [], onEvent: () => {} });

    expect(subscribeManyMock).not.toHaveBeenCalled();

    // close() must not throw and must remain idempotent even with no
    // underlying subscriptions.
    expect(() => handle.close()).not.toThrow();
    expect(() => handle.close()).not.toThrow();
  });

  it("closeOnEose:true without onEose: auto-closes after EOSE; subsequent events are dropped", () => {
    let capturedOnevent: ((e: unknown) => void) | undefined;
    let capturedOneose: (() => void) | undefined;
    const innerClose = vi.fn();
    subscribeManyMock.mockImplementation(
      (
        _relays: string[],
        _filter: unknown,
        params: { onevent: (e: unknown) => void; oneose?: () => void },
      ) => {
        capturedOnevent = params.onevent;
        capturedOneose = params.oneose;
        return { close: innerClose };
      },
    );

    const received: string[] = [];
    const pool = createPool({ relays: ["wss://a.test"] });
    pool.subscribe({
      filters: [{ kinds: [38000] }],
      onEvent: (event) => received.push(event.id),
      closeOnEose: true,
      // Intentionally no onEose — exercises the closeOnEose-only branch
      // (different oneose closure than the one with onEose set).
    });

    // oneose handler must be wired even without onEose so closeOnEose
    // can do its job.
    expect(capturedOneose).toBeDefined();

    // Pre-EOSE event flows through.
    const evt = (id: string) => ({
      id,
      pubkey: "pk",
      created_at: 1,
      kind: 38000,
      tags: [],
      content: "",
      sig: "",
    });
    seenOnMock.set("pre", new Set([{ url: "wss://a.test" }]));
    capturedOnevent?.(evt("pre"));
    expect(received).toEqual(["pre"]);

    // EOSE fires -> handle should auto-close.
    capturedOneose?.();
    expect(innerClose).toHaveBeenCalledTimes(1);

    // Late event must be dropped (post-close gating).
    seenOnMock.set("post", new Set([{ url: "wss://a.test" }]));
    capturedOnevent?.(evt("post"));
    expect(received).toEqual(["pre"]);
  });

  it("multiple concurrent subscribes are isolated: each handle gets its own events; closing one leaves the other live", () => {
    // Each subscribeMany call gets its own onevent/closer pair. Capture
    // them so we can fire events into one subscription at a time and
    // verify isolation.
    type Capture = {
      onevent: (e: unknown) => void;
      close: ReturnType<typeof vi.fn>;
      filter: unknown;
    };
    const captures: Capture[] = [];
    subscribeManyMock.mockImplementation(
      (_relays: string[], filter: unknown, params: { onevent: (e: unknown) => void }) => {
        const close = vi.fn();
        captures.push({ onevent: params.onevent, close, filter });
        return { close };
      },
    );

    const pool = createPool({ relays: ["wss://a.test"] });
    const receivedA: string[] = [];
    const receivedB: string[] = [];
    const handleA = pool.subscribe({
      filters: [{ kinds: [38172] }],
      onEvent: (event) => receivedA.push(event.id),
    });
    const handleB = pool.subscribe({
      filters: [{ kinds: [38000] }],
      onEvent: (event) => receivedB.push(event.id),
    });

    expect(captures).toHaveLength(2);
    // Ordered by subscribe() call order.
    expect(captures[0]?.filter).toEqual({ kinds: [38172] });
    expect(captures[1]?.filter).toEqual({ kinds: [38000] });

    // Fire an event into A only.
    const evt = (id: string, kind: number) => ({
      id,
      pubkey: "pk",
      created_at: 1,
      kind,
      tags: [],
      content: "",
      sig: "",
    });
    seenOnMock.set("a1", new Set([{ url: "wss://a.test" }]));
    captures[0]?.onevent(evt("a1", 38172));
    expect(receivedA).toEqual(["a1"]);
    expect(receivedB).toEqual([]);

    // Fire an event into B only.
    seenOnMock.set("b1", new Set([{ url: "wss://a.test" }]));
    captures[1]?.onevent(evt("b1", 38000));
    expect(receivedA).toEqual(["a1"]);
    expect(receivedB).toEqual(["b1"]);

    // Close A. B's underlying closer must not fire and B must keep
    // delivering.
    handleA.close();
    expect(captures[0]?.close).toHaveBeenCalledTimes(1);
    expect(captures[1]?.close).not.toHaveBeenCalled();

    seenOnMock.set("b2", new Set([{ url: "wss://a.test" }]));
    captures[1]?.onevent(evt("b2", 38000));
    expect(receivedB).toEqual(["b1", "b2"]);

    // Late event into A is dropped (post-close gating from Fix 3
    // applies per-handle).
    seenOnMock.set("a2", new Set([{ url: "wss://a.test" }]));
    captures[0]?.onevent(evt("a2", 38172));
    expect(receivedA).toEqual(["a1"]);

    // Closing B now tears down only B's closer.
    handleB.close();
    expect(captures[1]?.close).toHaveBeenCalledTimes(1);
  });
});
