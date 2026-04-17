/**
 * NUT-06 `/v1/info` HTTP client for Cashu mints.
 *
 * Two surfaces:
 *
 *   - `fetchMintInfo(url, opts?)` — single one-shot fetch with a hard timeout.
 *     Used directly by tests and for one-off "refresh now" UI actions.
 *
 *   - `createMintInfoFetcher({ concurrency, ttlMs })` — a wrapper that adds
 *     a per-URL TTL cache and a global concurrency cap (semaphore). This is
 *     the primary surface the scheduler consumes: it dedupes in-flight
 *     requests, short-circuits cached results within `ttlMs`, and prevents
 *     us from hammering mints when many announcements land at once.
 *
 * Borrows the shape of cashu-kym's `src/request.ts` (per-origin semaphore +
 * in-flight dedupe + TTL cache, see /srv/forge/projects/bitcoinmints/audit/cashu-kym.md §6),
 * trimmed down: kym does retries-with-backoff inside the fetcher; we keep
 * the fetcher pure (one fetch attempt) and let the scheduler decide retry
 * cadence at a higher level (see scheduler/index.ts backoff logic). This
 * keeps the fetcher easy to mock in tests and lets retries observe whatever
 * the scheduler's policy is at the time, not whatever the fetcher froze in.
 *
 * Failure-mode strings are human-readable on purpose — they round-trip into
 * Dexie as `MintInfoRow.lastError` and surface in dev panels.
 */

/**
 * NUT-06 `/v1/info` response shape — the subset we care about.
 *
 * Cashu mints in the wild don't all set every field. We type optional
 * everything except `pubkey` (NUT-06 mandatory + this is what Layer B
 * compares against the announcement signer). `nuts` is a bag of
 * NUT-name -> capability shape; we under-spec it here and pass through
 * whatever shape the mint emits — see data-model-v1.md §7.
 */
export type MintInfoV1 = {
  /** Mint's compressed/x-only secp256k1 pubkey. NUT-06 mandatory. */
  pubkey: string;
  name?: string;
  version?: string;
  description?: string;
  description_long?: string;
  contact?: Array<{ method: string; info: string }>;
  motd?: string;
  icon_url?: string;
  urls?: string[];
  time?: number;
  nuts?: Record<string, { methods?: unknown[]; disabled?: boolean; supported?: unknown }>;
  tos_url?: string;
  /** Pass-through for forward-compatibility with NUT-06 fields we don't model. */
  [key: string]: unknown;
};

/** Discriminated result so callers don't have to try/catch around the fetcher. */
export type MintInfoResult =
  | { ok: true; info: MintInfoV1 }
  | { ok: false; error: string; status?: number };

export type FetchMintInfoOptions = {
  /** Hard timeout in ms. Default: 5000. */
  timeoutMs?: number;
  /** Optional caller-supplied AbortSignal (composed with the internal timeout). */
  signal?: AbortSignal;
};

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Validate the URL upfront. Rejects non-https schemes (keeps us out of the
 * SSRF-via-http class of bugs the v0 directory was vulnerable to per
 * audit/DIGEST.md §3) and surfaces obvious garbage (no scheme, etc.) as a
 * structured failure rather than a thrown exception.
 */
function validateMintUrl(raw: string): { ok: true; url: URL } | { ok: false; error: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "invalid URL" };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, error: `non-https scheme (${parsed.protocol.replace(":", "")})` };
  }
  return { ok: true, url: parsed };
}

/**
 * Compose a caller-supplied AbortSignal with our internal timeout signal.
 * AbortSignal.any() is the modern way (Node 20+, modern browsers) but we
 * polyfill the merge by hand to keep the dep surface minimal — the
 * original AbortSignal.any signature is part of the platform but not yet
 * everywhere our app might run.
 */
function composeSignals(
  timeoutMs: number,
  external?: AbortSignal,
): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  const onExternalAbort = () => {
    clearTimeout(timer);
    controller.abort(external?.reason);
  };
  if (external) {
    if (external.aborted) {
      clearTimeout(timer);
      controller.abort(external.reason);
    } else {
      external.addEventListener("abort", onExternalAbort, { once: true });
    }
  }
  return {
    signal: controller.signal,
    cancel: () => {
      clearTimeout(timer);
      external?.removeEventListener("abort", onExternalAbort);
    },
  };
}

/**
 * Build a canonical /v1/info URL from the mint base URL. Trailing slashes
 * on the base are tolerated; the result is always exactly one slash before
 * `v1/info`.
 */
function buildInfoUrl(base: URL): string {
  const trimmed = base.toString().replace(/\/+$/, "");
  return `${trimmed}/v1/info`;
}

/**
 * Fetch and parse `/v1/info` for a single mint URL. Always resolves — never
 * rejects. Errors flow through `MintInfoResult.error` for the caller to log.
 */
export async function fetchMintInfo(
  url: string,
  opts: FetchMintInfoOptions = {},
): Promise<MintInfoResult> {
  const validated = validateMintUrl(url);
  if (!validated.ok) return { ok: false, error: validated.error };

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const { signal, cancel } = composeSignals(timeoutMs, opts.signal);
  const target = buildInfoUrl(validated.url);

  let response: Response;
  try {
    response = await fetch(target, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal,
    });
  } catch (err) {
    cancel();
    // AbortError when our internal timeout fired vs caller cancellation.
    // We surface the timeout as the human-readable string the data-model
    // doc documents; pass other errors through verbatim.
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, error: "connect ETIMEDOUT" };
    }
    return { ok: false, error: err instanceof Error ? err.message : "network error" };
  }

  cancel();

  if (!response.ok) {
    return { ok: false, error: `non-2xx (${response.status})`, status: response.status };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: "invalid JSON", status: response.status };
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "invalid JSON", status: response.status };
  }

  const obj = body as Record<string, unknown>;
  if (typeof obj.pubkey !== "string" || obj.pubkey.length === 0) {
    return { ok: false, error: "missing pubkey field", status: response.status };
  }

  return { ok: true, info: obj as MintInfoV1 };
}

/** A wrapped fetcher with TTL caching + concurrency limiting. */
export type MintInfoFetcher = (url: string) => Promise<MintInfoResult>;

export type MintInfoFetcherOptions = {
  /** Max concurrent in-flight fetches across the entire fetcher. */
  concurrency: number;
  /** Cache TTL in ms. Cached `MintInfoResult`s younger than this short-circuit. */
  ttlMs: number;
  /**
   * Override the underlying single-fetch function. Useful in tests; defaults
   * to `fetchMintInfo`.
   */
  fetchImpl?: (url: string, opts?: FetchMintInfoOptions) => Promise<MintInfoResult>;
  /** Optional clock injector for deterministic TTL tests. Defaults to Date.now. */
  now?: () => number;
};

type CacheEntry = { result: MintInfoResult; at: number };

/**
 * Build a fetcher that:
 *   - caches results per URL for `ttlMs` (both ok and !ok — failures back
 *     off naturally without the scheduler having to dedupe its retries);
 *   - dedupes concurrent requests for the same URL (in-flight map);
 *   - caps total in-flight requests at `concurrency` via a tiny semaphore.
 *
 * The semaphore is a FIFO queue of resolvers — when a slot frees up, the
 * oldest waiter wins. Not strictly fair across URLs (a high-traffic URL
 * can queue many requests) but the in-flight dedup means each URL gets at
 * most one slot, so per-URL fairness falls out for free.
 */
export function createMintInfoFetcher(opts: MintInfoFetcherOptions): MintInfoFetcher {
  if (opts.concurrency < 1) {
    throw new Error("createMintInfoFetcher: concurrency must be >= 1");
  }
  if (opts.ttlMs < 0) {
    throw new Error("createMintInfoFetcher: ttlMs must be >= 0");
  }

  const fetchImpl = opts.fetchImpl ?? fetchMintInfo;
  const now = opts.now ?? Date.now;
  const cache = new Map<string, CacheEntry>();
  const inflight = new Map<string, Promise<MintInfoResult>>();

  // Semaphore: tracks active count + waiter queue.
  let active = 0;
  const waiters: Array<() => void> = [];

  const acquire = (): Promise<void> => {
    if (active < opts.concurrency) {
      active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      waiters.push(() => {
        active++;
        resolve();
      });
    });
  };

  const release = (): void => {
    active--;
    const next = waiters.shift();
    if (next) next();
  };

  return async function fetcher(url: string): Promise<MintInfoResult> {
    // 1. Cache check — short-circuits both success and failure within TTL.
    const cached = cache.get(url);
    if (cached && now() - cached.at < opts.ttlMs) {
      return cached.result;
    }

    // 2. In-flight dedup — collapse concurrent calls for same URL to one
    //    underlying fetch.
    const existing = inflight.get(url);
    if (existing) return existing;

    const promise = (async () => {
      await acquire();
      try {
        const result = await fetchImpl(url);
        cache.set(url, { result, at: now() });
        return result;
      } finally {
        release();
        inflight.delete(url);
      }
    })();
    inflight.set(url, promise);
    return promise;
  };
}
