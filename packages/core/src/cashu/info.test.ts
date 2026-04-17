import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMintInfoFetcher, fetchMintInfo, type MintInfoResult } from "./info";

// Minimal Response shape we need from `fetch`. Wrapping inline keeps the
// global Response constructor's quirks (some Node runtimes don't expose
// the same fields the way browsers do) out of the test surface.
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/plain" } });
}

describe("fetchMintInfo — happy path + parse", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("returns ok+info on a 200 + spec-conforming JSON", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        pubkey: "02abc",
        name: "TestMint",
        version: "Nutshell/0.16",
        nuts: { "1": { supported: true } },
      }),
    );

    const r = await fetchMintInfo("https://mint.example.com");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.info.pubkey).toBe("02abc");
    expect(r.info.name).toBe("TestMint");
    expect(r.info.nuts).toEqual({ "1": { supported: true } });
  });

  it("hits exactly the /v1/info path appended to the base URL", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ pubkey: "02abc" }));
    await fetchMintInfo("https://mint.example.com");
    const call = fetchSpy.mock.calls[0];
    expect(call?.[0]).toBe("https://mint.example.com/v1/info");
  });

  it("normalizes a trailing slash on the base URL (no double slash)", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ pubkey: "02abc" }));
    await fetchMintInfo("https://mint.example.com/");
    const call = fetchSpy.mock.calls[0];
    expect(call?.[0]).toBe("https://mint.example.com/v1/info");
  });
});

describe("fetchMintInfo — failure modes", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("rejects http:// upfront without hitting fetch", async () => {
    const r = await fetchMintInfo("http://insecure.example.com");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("non-https");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects garbage URL strings without hitting fetch", async () => {
    const r = await fetchMintInfo("not a url at all");
    expect(r.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns non-2xx error for a 404", async () => {
    fetchSpy.mockResolvedValueOnce(textResponse("not found", 404));
    const r = await fetchMintInfo("https://mint.example.com");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("non-2xx (404)");
    expect(r.status).toBe(404);
  });

  it("returns non-2xx error for a 500", async () => {
    fetchSpy.mockResolvedValueOnce(textResponse("boom", 500));
    const r = await fetchMintInfo("https://mint.example.com");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("non-2xx (500)");
    expect(r.status).toBe(500);
  });

  it("surfaces a network error message", async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError("connect ECONNREFUSED"));
    const r = await fetchMintInfo("https://mint.example.com");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("ECONNREFUSED");
  });

  it("returns 'connect ETIMEDOUT' when the internal timer aborts", async () => {
    // Simulate a fetch that respects AbortSignal: never resolve, just listen
    // for abort and reject with an AbortError.
    fetchSpy.mockImplementation(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal as AbortSignal | undefined;
          signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );
    const r = await fetchMintInfo("https://mint.example.com", { timeoutMs: 5 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("connect ETIMEDOUT");
  });

  it("returns 'invalid JSON' when the body is not parseable", async () => {
    fetchSpy.mockResolvedValueOnce(textResponse("<html>oops</html>", 200));
    const r = await fetchMintInfo("https://mint.example.com");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("invalid JSON");
  });

  it("returns 'invalid JSON' when the body is a JSON array (not an object)", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse([1, 2, 3]));
    const r = await fetchMintInfo("https://mint.example.com");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("invalid JSON");
  });

  it("returns 'missing pubkey field' when JSON parses but lacks pubkey", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ name: "no key here" }));
    const r = await fetchMintInfo("https://mint.example.com");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("missing pubkey field");
  });

  it("returns 'missing pubkey field' when pubkey is empty string", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ pubkey: "" }));
    const r = await fetchMintInfo("https://mint.example.com");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("missing pubkey field");
  });
});

describe("createMintInfoFetcher — TTL cache", () => {
  it("returns the cached result without re-invoking fetch when within TTL", async () => {
    const fetchImpl = vi
      .fn<(url: string) => Promise<MintInfoResult>>()
      .mockResolvedValue({ ok: true, info: { pubkey: "02abc" } });
    let now = 1000;
    const fetcher = createMintInfoFetcher({
      concurrency: 4,
      ttlMs: 60_000,
      fetchImpl,
      now: () => now,
    });

    await fetcher("https://mint.example.com");
    now = 1000 + 30_000; // halfway through TTL
    await fetcher("https://mint.example.com");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("re-fetches once the TTL elapses", async () => {
    const fetchImpl = vi
      .fn<(url: string) => Promise<MintInfoResult>>()
      .mockResolvedValueOnce({ ok: true, info: { pubkey: "02abc" } })
      .mockResolvedValueOnce({ ok: true, info: { pubkey: "02xyz" } });
    let now = 0;
    const fetcher = createMintInfoFetcher({
      concurrency: 4,
      ttlMs: 1000,
      fetchImpl,
      now: () => now,
    });
    const r1 = await fetcher("https://mint.example.com");
    now = 2000; // TTL expired
    const r2 = await fetcher("https://mint.example.com");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(r1.ok && r1.info.pubkey).toBe("02abc");
    expect(r2.ok && r2.info.pubkey).toBe("02xyz");
  });

  it("caches failures (so retry storms are avoided)", async () => {
    const fetchImpl = vi
      .fn<(url: string) => Promise<MintInfoResult>>()
      .mockResolvedValue({ ok: false, error: "non-2xx (500)", status: 500 });
    const fetcher = createMintInfoFetcher({
      concurrency: 4,
      ttlMs: 60_000,
      fetchImpl,
    });
    await fetcher("https://broken.example.com");
    await fetcher("https://broken.example.com");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("createMintInfoFetcher — concurrency limiter", () => {
  it("never runs more than `concurrency` fetches in flight at once", async () => {
    // Track the peak number of in-flight fetchImpl calls. Each call hangs on
    // a deferred promise until the test releases it explicitly, so we can
    // step the system one unit of progress at a time.
    let inFlight = 0;
    let peak = 0;
    const pending: Array<() => void> = [];
    const fetchImpl = vi.fn<(url: string) => Promise<MintInfoResult>>(
      () =>
        new Promise<MintInfoResult>((resolve) => {
          inFlight++;
          peak = Math.max(peak, inFlight);
          pending.push(() => {
            inFlight--;
            resolve({ ok: true, info: { pubkey: "02abc" } });
          });
        }),
    );

    const fetcher = createMintInfoFetcher({
      concurrency: 2,
      ttlMs: 0, // disable cache so every call goes through
      fetchImpl,
    });

    // Fire 10 requests against 10 distinct URLs (so in-flight dedup
    // doesn't collapse them).
    const urls = Array.from({ length: 10 }, (_, i) => `https://mint${i}.example.com`);
    const promises = urls.map((u) => fetcher(u));

    // Let microtasks settle so the first wave of fetches register as
    // in-flight. Only `concurrency` should have started.
    await Promise.resolve();
    await Promise.resolve();
    expect(inFlight).toBe(2);
    expect(peak).toBe(2);

    // Step through: each release frees one slot, then we yield twice so
    // the freed semaphore slot can be picked up by a waiter and the next
    // fetchImpl can register itself in-flight.
    while (pending.length > 0) {
      const r = pending.shift();
      r?.();
      // First yield: release() runs and pulls a waiter off the queue.
      // Second yield: the awaiting `acquire()` resumes, calls fetchImpl,
      // which pushes its own resolver into `pending`.
      await Promise.resolve();
      await Promise.resolve();
      expect(inFlight).toBeLessThanOrEqual(2);
    }

    await Promise.all(promises);
    expect(peak).toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(10);
  });

  it("dedups concurrent calls for the same URL into one underlying fetch", async () => {
    const releases: Array<(r: MintInfoResult) => void> = [];
    const fetchImpl = vi.fn<(url: string) => Promise<MintInfoResult>>(
      () =>
        new Promise<MintInfoResult>((resolve) => {
          releases.push(resolve);
        }),
    );
    const fetcher = createMintInfoFetcher({
      concurrency: 4,
      ttlMs: 0,
      fetchImpl,
    });

    const p1 = fetcher("https://mint.example.com");
    const p2 = fetcher("https://mint.example.com");
    const p3 = fetcher("https://mint.example.com");

    // Yield so the first call can register itself as in-flight.
    await Promise.resolve();
    expect(releases.length).toBe(1);
    releases[0]?.({ ok: true, info: { pubkey: "02abc" } });
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(r1.ok && r1.info.pubkey).toBe("02abc");
    expect(r2.ok && r2.info.pubkey).toBe("02abc");
    expect(r3.ok && r3.info.pubkey).toBe("02abc");
  });

  it("rejects bogus options at construction", () => {
    expect(() => createMintInfoFetcher({ concurrency: 0, ttlMs: 1000 })).toThrow();
    expect(() => createMintInfoFetcher({ concurrency: -1, ttlMs: 1000 })).toThrow();
    expect(() => createMintInfoFetcher({ concurrency: 1, ttlMs: -1 })).toThrow();
    // Split TTL validation
    expect(() => createMintInfoFetcher({ concurrency: 1, ttlOkMs: -1 })).toThrow();
    expect(() => createMintInfoFetcher({ concurrency: 1, ttlFailMs: -1 })).toThrow();
  });
});

describe("createMintInfoFetcher — split ok/fail TTL", () => {
  it("expires fail entries on the shorter ttlFailMs even when ttlOkMs is long", async () => {
    // Pin the silent-failure fix: a flaky mint should be re-tried within
    // ttlFailMs, not pinned for the full ok TTL window.
    const fetchImpl = vi
      .fn<(url: string) => Promise<MintInfoResult>>()
      .mockResolvedValueOnce({ ok: false, error: "non-2xx (500)", status: 500 })
      .mockResolvedValueOnce({ ok: true, info: { pubkey: "02abc" } });
    let now = 0;
    const fetcher = createMintInfoFetcher({
      concurrency: 4,
      ttlOkMs: 5 * 60_000, // 5 min for OK
      ttlFailMs: 30_000, // 30 s for fail
      fetchImpl,
      now: () => now,
    });

    const r1 = await fetcher("https://broken.example.com");
    expect(r1.ok).toBe(false);

    // 31s later — fail TTL has expired, but ok TTL would still be active.
    now = 31_000;
    const r2 = await fetcher("https://broken.example.com");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(r2.ok).toBe(true);
  });

  it("keeps ok entries cached beyond the short fail TTL", async () => {
    const fetchImpl = vi
      .fn<(url: string) => Promise<MintInfoResult>>()
      .mockResolvedValue({ ok: true, info: { pubkey: "02abc" } });
    let now = 0;
    const fetcher = createMintInfoFetcher({
      concurrency: 4,
      ttlOkMs: 5 * 60_000,
      ttlFailMs: 30_000,
      fetchImpl,
      now: () => now,
    });

    await fetcher("https://mint.example.com");
    // Past the fail TTL but well within the ok TTL — must NOT re-fetch.
    now = 60_000;
    await fetcher("https://mint.example.com");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("legacy single ttlMs continues to apply to both arms", async () => {
    // Backwards-compat: callers passing only ttlMs get the original
    // single-bucket behavior.
    const fetchImpl = vi
      .fn<(url: string) => Promise<MintInfoResult>>()
      .mockResolvedValueOnce({ ok: false, error: "non-2xx (500)", status: 500 })
      .mockResolvedValueOnce({ ok: false, error: "non-2xx (500)", status: 500 });
    let now = 0;
    const fetcher = createMintInfoFetcher({
      concurrency: 4,
      ttlMs: 60_000,
      fetchImpl,
      now: () => now,
    });
    await fetcher("https://broken.example.com");
    now = 30_000; // halfway through legacy TTL
    await fetcher("https://broken.example.com");
    expect(fetchImpl).toHaveBeenCalledTimes(1); // single TTL still in effect
  });
});
