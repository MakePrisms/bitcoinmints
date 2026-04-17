import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock nostr-tools SimplePool at module load. Each pool.subscribeMany
// returns a closer we can spy on; pool.close() collects calls for inspection.
const subscribeManyMock = vi.fn();
const closeMock = vi.fn();
const seenOnMock = new Map<string, Set<{ url: string }>>();

vi.mock("nostr-tools/pool", () => {
  return {
    SimplePool: class {
      subscribeMany(...args: unknown[]) {
        return subscribeManyMock(...args);
      }
      close(...args: unknown[]) {
        return closeMock(...args);
      }
      seenOn = seenOnMock;
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
});
