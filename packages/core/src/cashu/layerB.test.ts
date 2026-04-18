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
    if (!r.verified) return;
    expect(r.info.pubkey).toBe("02abc");
    expect(r.url).toBe("https://mint.example.com");
  });

  it("returns verified=true when ANY of multiple URLs matches", async () => {
    const row = makeRow({
      pubkey: "02abc",
      u: ["https://mint-a.example.com", "https://mint-b.example.com"],
    });
    // First fetch returns mismatched pubkey, second returns the right one.
    const fetcher = okFetcher({
      "https://mint-a.example.com": "02deadbeef",
      "https://mint-b.example.com": "02abc",
    });
    const r = await verifySignerBinding(row, fetcher);
    expect(r.verified).toBe(true);
    if (!r.verified) return;
    expect(r.info.pubkey).toBe("02abc");
    // The matched URL is the one that returned the signer's pubkey, not u[0].
    expect(r.url).toBe("https://mint-b.example.com");
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
    const fetcher = okFetcher({ "https://mint.example.com": "02deadbeef" });
    const r = await verifySignerBinding(row, fetcher);
    expect(r.verified).toBe(false);
    if (r.verified) return;
    expect(r.reason).toContain("pubkey-mismatch");
    expect(r.reason).toContain("02abc"); // event signer
    expect(r.reason).toContain("02deadbeef"); // actual mint pubkey source (lowercase hex)
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
    if (r.verified) return;
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
      return { ok: true, info: { pubkey: "02deadbeef" } };
    });
    const r = await verifySignerBinding(row, fetcher);
    expect(r.verified).toBe(false);
    if (r.verified) return;
    expect(r.reason).toContain("pubkey-mismatch");
    expect(r.reason).toContain("02deadbeef");
  });

  it("returns reason='no-urls' when announcement.u is empty", async () => {
    const row = makeRow({ pubkey: "02abc", u: [] });
    const fetcher: MintInfoFetcher = vi.fn(async () => {
      throw new Error("must not be called");
    });
    const r = await verifySignerBinding(row, fetcher);
    expect(r.verified).toBe(false);
    if (r.verified) return;
    expect(r.reason).toBe("no-urls");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("P0.1: ok response with NO pubkey AND NO contact.nostr returns 'no-signer-source'", async () => {
    // The audit's `null` case: a /v1/info that responds successfully but
    // exposes neither `pubkey` (P0.2 made that optional) nor a
    // `contact.[method=nostr]` entry. Genuinely cannot verify — scheduler
    // persists `null`, not `false`.
    const row = makeRow({
      pubkey: "02abc",
      u: ["https://mint.example.com"],
    });
    const fetcher: MintInfoFetcher = vi.fn(
      async (): Promise<MintInfoResult> => ({
        ok: true,
        info: {
          name: "Pubkey-less mint",
          contact: [{ method: "email", info: "ops@example.com" }],
        },
      }),
    );
    const r = await verifySignerBinding(row, fetcher);
    expect(r.verified).toBe(false);
    if (r.verified) return;
    expect(r.reason).toBe("no-signer-source");
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
    if (r.verified) return;
    expect(r.reason).toBe("non-cashu");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("verifySignerBinding — P0.1 widened signer sources (contact.nostr)", () => {
  // 64-char lowercase hex used both as the event signer and as the
  // contact.nostr identity it should match against. Distinct from
  // info.pubkey to prove that contact.nostr is independently sufficient.
  const EVENT_SIGNER = "a".repeat(64);
  const MINT_PUBKEY = "02".padEnd(66, "b");

  it("verifies when contact.[method=nostr].info matches signer (hex form)", async () => {
    const row = makeRow({
      pubkey: EVENT_SIGNER,
      d: MINT_PUBKEY,
      u: ["https://mint.example.com"],
    });
    const fetcher: MintInfoFetcher = vi.fn(
      async (): Promise<MintInfoResult> => ({
        ok: true,
        info: {
          pubkey: MINT_PUBKEY, // does NOT match signer
          contact: [
            { method: "email", info: "ops@example.com" },
            { method: "nostr", info: EVENT_SIGNER }, // matches via widened source
          ],
        },
      }),
    );
    const r = await verifySignerBinding(row, fetcher);
    expect(r.verified).toBe(true);
  });

  it("verifies when contact.nostr is an npub bech32 that decodes to signer", async () => {
    const signerHex = "1".repeat(64);
    // Pre-computed: nip19.npubEncode("1111111111111111111111111111111111111111111111111111111111111111")
    const signerNpub = "npub1zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygse4sl3h";
    const row = makeRow({
      pubkey: signerHex,
      d: MINT_PUBKEY,
      u: ["https://mint.example.com"],
    });
    const fetcher: MintInfoFetcher = vi.fn(
      async (): Promise<MintInfoResult> => ({
        ok: true,
        info: {
          // No mint pubkey — only contact.nostr (as npub) declares the signer.
          contact: [{ method: "nostr", info: signerNpub }],
        },
      }),
    );
    const r = await verifySignerBinding(row, fetcher);
    expect(r.verified).toBe(true);
  });

  it("verifies when info.pubkey is absent but contact.nostr matches signer", async () => {
    // P0.1 + P0.2: pubkey-less mint that declares its nostr identity via
    // contact only. Spec-conforming and previously rejected.
    const row = makeRow({
      pubkey: EVENT_SIGNER,
      d: MINT_PUBKEY,
      u: ["https://mint.example.com"],
    });
    const fetcher: MintInfoFetcher = vi.fn(
      async (): Promise<MintInfoResult> => ({
        ok: true,
        info: {
          // pubkey omitted entirely.
          contact: [{ method: "nostr", info: EVENT_SIGNER }],
        },
      }),
    );
    const r = await verifySignerBinding(row, fetcher);
    expect(r.verified).toBe(true);
  });

  it("mismatch when neither info.pubkey nor any contact.nostr matches signer", async () => {
    const row = makeRow({
      pubkey: EVENT_SIGNER,
      d: MINT_PUBKEY,
      u: ["https://mint.example.com"],
    });
    const otherSigner = "c".repeat(64);
    const fetcher: MintInfoFetcher = vi.fn(
      async (): Promise<MintInfoResult> => ({
        ok: true,
        info: {
          pubkey: MINT_PUBKEY,
          contact: [{ method: "nostr", info: otherSigner }],
        },
      }),
    );
    const r = await verifySignerBinding(row, fetcher);
    expect(r.verified).toBe(false);
    if (r.verified) return;
    expect(r.reason).toContain("pubkey-mismatch");
    expect(r.reason).toContain(EVENT_SIGNER);
    expect(r.reason).toContain(otherSigner);
  });

  it("ignores non-nostr contact methods (email, twitter, etc.)", async () => {
    const row = makeRow({
      pubkey: EVENT_SIGNER,
      d: MINT_PUBKEY,
      u: ["https://mint.example.com"],
    });
    const fetcher: MintInfoFetcher = vi.fn(
      async (): Promise<MintInfoResult> => ({
        ok: true,
        info: {
          pubkey: MINT_PUBKEY, // doesn't match
          contact: [
            { method: "email", info: EVENT_SIGNER }, // looks-like-hex but wrong method
            { method: "twitter", info: "@signer" },
          ],
        },
      }),
    );
    const r = await verifySignerBinding(row, fetcher);
    expect(r.verified).toBe(false);
    if (r.verified) return;
    // Only `info.pubkey` counts — and it didn't match. So pubkey-mismatch.
    expect(r.reason).toContain("pubkey-mismatch");
  });

  it("malformed npub in contact.nostr is silently dropped (other contacts still considered)", async () => {
    const row = makeRow({
      pubkey: EVENT_SIGNER,
      d: MINT_PUBKEY,
      u: ["https://mint.example.com"],
    });
    const fetcher: MintInfoFetcher = vi.fn(
      async (): Promise<MintInfoResult> => ({
        ok: true,
        info: {
          // First contact is a malformed npub (bad checksum), second is the
          // hex form that matches. The malformed entry must NOT throw.
          contact: [
            { method: "nostr", info: "npub1notavalidbech32" },
            { method: "nostr", info: EVENT_SIGNER },
          ],
        },
      }),
    );
    const r = await verifySignerBinding(row, fetcher);
    expect(r.verified).toBe(true);
  });
});

describe("verifySignerBinding — P0.1 spec-conforming `event.pubkey != d` case", () => {
  // Audit blind spot: existing fixtures set `event.pubkey === d`, masking
  // the real spec-conforming case where the operator's nostr pubkey signs
  // the event but the mint's secp256k1 pubkey is the d-tag. P0.1 widening
  // means the operator binding goes through `info.contact.[method=nostr]`,
  // not the (different) `info.pubkey`.
  it("verifies an app-signed announcement when contact.nostr declares the signer", async () => {
    const operatorSigner = "ab".repeat(32); // event.pubkey, distinct from d
    const mintPubkey = "02".padEnd(66, "c"); // d-tag = mint's secp256k1
    const row = makeRow({
      pubkey: operatorSigner,
      d: mintPubkey, // distinct: this is the spec-conforming shape
      u: ["https://mint.example.com"],
    });
    const fetcher: MintInfoFetcher = vi.fn(
      async (): Promise<MintInfoResult> => ({
        ok: true,
        info: {
          pubkey: mintPubkey, // mint's own secp256k1 — matches d, NOT signer
          contact: [
            { method: "email", info: "ops@example.com" },
            { method: "nostr", info: operatorSigner }, // operator identity = signer
          ],
        },
      }),
    );
    const r = await verifySignerBinding(row, fetcher);
    expect(r.verified).toBe(true);
    if (!r.verified) return;
    // We persist the matching mint's response — sanity check the d-tag
    // pubkey is preserved for downstream MintInfoRow writes.
    expect(r.info.pubkey).toBe(mintPubkey);
  });
});

describe("verifySignerBinding — multi-URL matched URL tracking", () => {
  it("returns the URL that actually matched, not u[0]", async () => {
    // Two URLs: first returns wrong pubkey, second returns the matching one.
    // The result.url MUST point at the URL that verified, so the scheduler
    // can write the canonical URL into MintInfoRow rather than guessing.
    const row = makeRow({
      pubkey: "02abc",
      u: ["https://wrong.example", "https://right.example"],
    });
    const fetcher = okFetcher({
      "https://wrong.example": "02deadbeef",
      "https://right.example": "02abc",
    });
    const r = await verifySignerBinding(row, fetcher);
    expect(r.verified).toBe(true);
    if (!r.verified) return;
    expect(r.url).toBe("https://right.example");
    expect(r.url).not.toBe("https://wrong.example");
  });
});
