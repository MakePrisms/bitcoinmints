import { describe, expect, it, vi } from "vitest";
import type { AnnouncementRow } from "../cache";
import type { MintInfoFetcher, MintInfoResult } from "./info";
import { verifySignerBinding } from "./layerB";

// Build a stripped-down AnnouncementRow for tests. Only the fields Layer B
// reads need real values; the rest can be empty.
function makeRow(opts: {
  pubkey: string;
  u: string[];
  kind?: 38172 | 38173;
  d?: string;
}): AnnouncementRow {
  return {
    pubkey: opts.pubkey,
    kind: opts.kind ?? 38172,
    d: opts.d ?? opts.pubkey, // by convention d == pubkey for spec-conforming Cashu
    eventId: "deadbeef",
    createdAt: 1_700_000_000,
    u: opts.u,
    content: "",
    rawTags: [],
    verifiedBySignerBinding: null,
  };
}

function okFetcher(map: Record<string, string>): MintInfoFetcher {
  return vi.fn(async (url: string): Promise<MintInfoResult> => {
    const pk = map[url];
    if (pk === undefined) return { ok: false, error: "non-2xx (404)", status: 404 };
    return { ok: true, info: { pubkey: pk, name: `Mint at ${url}` } };
  });
}

describe("verifySignerBinding — Cashu happy path", () => {
  it("returns verified=true when single mint URL pubkey matches signer", async () => {
    const row = makeRow({
      pubkey: "02abc",
      u: ["https://mint.example.com"],
    });
    const fetcher = okFetcher({ "https://mint.example.com": "02abc" });
    const r = await verifySignerBinding(row, fetcher);
    expect(r.verified).toBe(true);
    expect(r.info?.pubkey).toBe("02abc");
    expect(r.reason).toBeUndefined();
  });

  it("returns verified=true when ANY of multiple URLs matches", async () => {
    const row = makeRow({
      pubkey: "02abc",
      u: ["https://mint-a.example.com", "https://mint-b.example.com"],
    });
    // First fetch returns mismatched pubkey, second returns the right one.
    const fetcher = okFetcher({
      "https://mint-a.example.com": "02zzz",
      "https://mint-b.example.com": "02abc",
    });
    const r = await verifySignerBinding(row, fetcher);
    expect(r.verified).toBe(true);
    expect(r.info?.pubkey).toBe("02abc");
  });

  it("does case-insensitive lowercase compare for pubkey match", async () => {
    const row = makeRow({
      pubkey: "02ABC",
      u: ["https://mint.example.com"],
    });
    const fetcher = okFetcher({ "https://mint.example.com": "02abc" });
    const r = await verifySignerBinding(row, fetcher);
    expect(r.verified).toBe(true);
  });

  it("short-circuits on first match (does not fetch remaining URLs)", async () => {
    const row = makeRow({
      pubkey: "02abc",
      u: ["https://mint-a.example.com", "https://mint-b.example.com", "https://mint-c.example.com"],
    });
    const fetcher = vi.fn(
      okFetcher({
        "https://mint-a.example.com": "02abc",
        "https://mint-b.example.com": "02abc",
        "https://mint-c.example.com": "02abc",
      }),
    );
    await verifySignerBinding(row, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith("https://mint-a.example.com");
  });
});

describe("verifySignerBinding — Cashu failure modes", () => {
  it("returns reason='pubkey-mismatch' when single URL responds with wrong pubkey", async () => {
    const row = makeRow({
      pubkey: "02abc",
      u: ["https://mint.example.com"],
    });
    const fetcher = okFetcher({ "https://mint.example.com": "02zzz" });
    const r = await verifySignerBinding(row, fetcher);
    expect(r.verified).toBe(false);
    expect(r.reason).toContain("pubkey-mismatch");
    expect(r.reason).toContain("02abc"); // announcement pubkey
    expect(r.reason).toContain("02zzz"); // actual mint pubkey
  });

  it("returns reason='all-fetches-failed' when every URL fails", async () => {
    const row = makeRow({
      pubkey: "02abc",
      u: ["https://broken-a.example.com", "https://broken-b.example.com"],
    });
    const fetcher: MintInfoFetcher = vi.fn(
      async (): Promise<MintInfoResult> => ({
        ok: false,
        error: "connect ETIMEDOUT",
      }),
    );
    const r = await verifySignerBinding(row, fetcher);
    expect(r.verified).toBe(false);
    expect(r.reason).toBe("all-fetches-failed");
    expect(fetcher).toHaveBeenCalledTimes(2); // tries every URL
  });

  it("mixed failure + mismatch reports pubkey-mismatch (some fetch succeeded)", async () => {
    const row = makeRow({
      pubkey: "02abc",
      u: ["https://broken.example.com", "https://wrong-pk.example.com"],
    });
    const fetcher: MintInfoFetcher = vi.fn(async (url: string): Promise<MintInfoResult> => {
      if (url.includes("broken")) {
        return { ok: false, error: "connect ETIMEDOUT" };
      }
      return { ok: true, info: { pubkey: "02zzz" } };
    });
    const r = await verifySignerBinding(row, fetcher);
    expect(r.verified).toBe(false);
    expect(r.reason).toContain("pubkey-mismatch");
    expect(r.reason).toContain("02zzz");
  });

  it("returns reason='no-urls' when announcement.u is empty", async () => {
    const row = makeRow({ pubkey: "02abc", u: [] });
    const fetcher: MintInfoFetcher = vi.fn(async () => {
      throw new Error("must not be called");
    });
    const r = await verifySignerBinding(row, fetcher);
    expect(r.verified).toBe(false);
    expect(r.reason).toBe("no-urls");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("verifySignerBinding — Fedimint rejection", () => {
  it("returns reason='non-cashu' for kind:38173 without fetching", async () => {
    const row = makeRow({
      pubkey: "02abc",
      u: ["fed11abc..."],
      kind: 38173,
    });
    const fetcher: MintInfoFetcher = vi.fn(async () => {
      throw new Error("must not be called");
    });
    const r = await verifySignerBinding(row, fetcher);
    expect(r.verified).toBe(false);
    expect(r.reason).toBe("non-cashu");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
