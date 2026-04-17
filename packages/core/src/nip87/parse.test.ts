import type { Event as NostrEvent } from "nostr-tools/core";
import { describe, expect, it } from "vitest";
import fixtures from "./__fixtures__/nip87-sample.json" with { type: "json" };
import { parseMintAnnouncement, parseRecommendation } from "./parse";

type Fixture = {
  cashu38172Curator: NostrEvent[];
  cashu38172Legacy: NostrEvent[];
  cashu38172SpecConforming: NostrEvent[];
  fedimint38173: NostrEvent[];
  recommendations38000: NostrEvent[];
};
const f = fixtures as unknown as Fixture;

describe("parseMintAnnouncement", () => {
  it("parses a real kind:38172 curator event into the expected shape", () => {
    const event = f.cashu38172Curator[0];
    if (!event) throw new Error("fixture missing cashu38172Curator[0]");

    const parsed = parseMintAnnouncement(event);
    expect(parsed).not.toBeNull();
    if (!parsed) return;

    expect(parsed.eventId).toBe(event.id);
    expect(parsed.kind).toBe(38172);
    expect(parsed.pubkey).toBe(event.pubkey);
    expect(parsed.createdAt).toBe(event.created_at);
    expect(parsed.d).toBeTypeOf("string");
    expect(parsed.u.length).toBeGreaterThan(0);
    expect(parsed.raw).toBe(event);
  });

  it("parses a spec-conforming 38172 with nuts tag into a number array", () => {
    const event = f.cashu38172SpecConforming[0];
    if (!event) throw new Error("fixture missing cashu38172SpecConforming[0]");

    const parsed = parseMintAnnouncement(event);
    expect(parsed).not.toBeNull();
    if (!parsed) return;

    expect(parsed.kind).toBe(38172);
    expect(parsed.nuts).toEqual([1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 14, 20]);
    expect(parsed.modules).toBeUndefined();
    expect(parsed.n).toBe("mainnet");
    expect(parsed.u).toEqual(["https://mint.alpha.test"]);
    expect(parsed.contentMetadata?.name).toBe("Mint Alpha (synthetic)");
    expect(parsed.contentMetadata?.picture).toBe("https://example.test/alpha.png");
  });

  it("parses a 38172 with multiple u tags into u: string[]", () => {
    const event = f.cashu38172SpecConforming[1];
    if (!event) throw new Error("fixture missing cashu38172SpecConforming[1]");

    const parsed = parseMintAnnouncement(event);
    expect(parsed).not.toBeNull();
    if (!parsed) return;

    expect(parsed.u).toEqual(["https://mint.beta.test", "https://mint.beta.test/v1"]);
    // No `n` tag in this fixture.
    expect(parsed.n).toBeUndefined();
    // Empty content -> no metadata.
    expect(parsed.contentMetadata).toBeUndefined();
  });

  it("parses a real kind:38173 Fedimint event with modules CSV", () => {
    const event = f.fedimint38173[0];
    if (!event) throw new Error("fixture missing fedimint38173[0]");

    const parsed = parseMintAnnouncement(event);
    expect(parsed).not.toBeNull();
    if (!parsed) return;

    expect(parsed.kind).toBe(38173);
    expect(parsed.nuts).toBeUndefined();
    expect(parsed.modules).toBeDefined();
    expect(Array.isArray(parsed.modules)).toBe(true);
    // First Fedimint fixture's modules tag is "ln,mint,wallet,lnv2,meta,multi_sig_stability_pool".
    expect(parsed.modules?.length).toBeGreaterThanOrEqual(2);
    expect(parsed.u.length).toBeGreaterThan(0);
  });

  it("returns null when the `d` tag is missing", () => {
    const bogus: NostrEvent = {
      id: "noid",
      pubkey: "nopubkey",
      created_at: 0,
      kind: 38172,
      tags: [["u", "https://nope.test"]],
      content: "",
      sig: "nosig",
    };
    expect(parseMintAnnouncement(bogus)).toBeNull();
  });

  it("returns null when there are no `u` tags", () => {
    const bogus: NostrEvent = {
      id: "noid",
      pubkey: "nopubkey",
      created_at: 0,
      kind: 38172,
      tags: [["d", `02${"0".repeat(64)}`]],
      content: "",
      sig: "nosig",
    };
    expect(parseMintAnnouncement(bogus)).toBeNull();
  });

  it("returns null for unexpected kinds", () => {
    const bogus: NostrEvent = {
      id: "noid",
      pubkey: "nopubkey",
      created_at: 0,
      kind: 1,
      tags: [
        ["d", "x"],
        ["u", "https://nope.test"],
      ],
      content: "",
      sig: "nosig",
    };
    expect(parseMintAnnouncement(bogus)).toBeNull();
  });

  it("tolerates non-JSON content (contentMetadata undefined, no throw)", () => {
    const event: NostrEvent = {
      id: "ok",
      pubkey: "0".repeat(64),
      created_at: 1234,
      kind: 38172,
      tags: [
        ["d", `02${"0".repeat(64)}`],
        ["u", "https://mint.example"],
      ],
      content: "[5/5] hello not JSON",
      sig: "sig",
    };
    const parsed = parseMintAnnouncement(event);
    expect(parsed).not.toBeNull();
    expect(parsed?.contentMetadata).toBeUndefined();
  });

  it("ignores unknown network values in `n` tag", () => {
    const event: NostrEvent = {
      id: "ok",
      pubkey: "0".repeat(64),
      created_at: 1234,
      kind: 38172,
      tags: [
        ["d", `02${"0".repeat(64)}`],
        ["u", "https://mint.example"],
        ["n", "bitcoin-but-weird"],
      ],
      content: "",
      sig: "sig",
    };
    const parsed = parseMintAnnouncement(event);
    expect(parsed).not.toBeNull();
    expect(parsed?.n).toBeUndefined();
  });
});

describe("parseRecommendation", () => {
  it("parses a real kind:38000 event with 2-arg rating tag", () => {
    // First fixture recommendation has ["rating","5"] + content "[5/5]".
    const event = f.recommendations38000[0];
    if (!event) throw new Error("fixture missing recommendations38000[0]");

    const parsed = parseRecommendation(event);
    expect(parsed).not.toBeNull();
    if (!parsed) return;

    expect(parsed.kind).toBe(38000);
    expect(parsed.eventId).toBe(event.id);
    expect(parsed.rating).toBe(5);
    // k tag references either 38172 or 38173 in all fixture recommendations.
    expect([38172, 38173]).toContain(parsed.k);
    expect(parsed.content).toBeTypeOf("string");
    expect(parsed.d).toBeTypeOf("string");
  });

  it("parses 3-arg rating tag ['rating','N','5'] as canonical format", () => {
    const event: NostrEvent = {
      id: "canon",
      pubkey: "0".repeat(64),
      created_at: 1234,
      kind: 38000,
      tags: [
        ["d", `02${"0".repeat(64)}`],
        ["k", "38172"],
        ["rating", "4", "5"],
      ],
      content: "",
      sig: "sig",
    };
    const parsed = parseRecommendation(event);
    expect(parsed?.rating).toBe(4);
  });

  it("prefers 3-arg rating tag over 2-arg when both present", () => {
    const event: NostrEvent = {
      id: "canon",
      pubkey: "0".repeat(64),
      created_at: 1234,
      kind: 38000,
      tags: [
        ["d", `02${"0".repeat(64)}`],
        ["rating", "1"],
        ["rating", "4", "5"],
      ],
      content: "",
      sig: "sig",
    };
    const parsed = parseRecommendation(event);
    expect(parsed?.rating).toBe(4);
  });

  it("prefers tag rating over content regex rating", () => {
    const event: NostrEvent = {
      id: "canon",
      pubkey: "0".repeat(64),
      created_at: 1234,
      kind: 38000,
      tags: [
        ["d", `02${"0".repeat(64)}`],
        ["rating", "3"],
      ],
      content: "[5/5] great",
      sig: "sig",
    };
    const parsed = parseRecommendation(event);
    expect(parsed?.rating).toBe(3);
  });

  it("falls back to content regex when no rating tag present (real corpus case)", () => {
    // Third fixture rec has only `k`, `u`, `d` tags + content "[5/5] I'm SUPERMAX…".
    const event = f.recommendations38000[2];
    if (!event) throw new Error("fixture missing recommendations38000[2]");
    const parsed = parseRecommendation(event);
    expect(parsed?.rating).toBe(5);
  });

  it("returns rating undefined when neither tag nor content regex match", () => {
    // Fifth fixture rec is a real empty-content Fedimint rec with no rating.
    const event = f.recommendations38000[4];
    if (!event) throw new Error("fixture missing recommendations38000[4]");
    const parsed = parseRecommendation(event);
    expect(parsed).not.toBeNull();
    expect(parsed?.rating).toBeUndefined();
  });

  it("accepts fractional ratings via content regex (3.5/5)", () => {
    const event: NostrEvent = {
      id: "frac",
      pubkey: "0".repeat(64),
      created_at: 1234,
      kind: 38000,
      tags: [["d", `02${"0".repeat(64)}`]],
      content: "[3.5/5] mostly fine",
      sig: "sig",
    };
    const parsed = parseRecommendation(event);
    expect(parsed?.rating).toBe(3.5);
  });

  it("rejects out-of-range ratings from content regex", () => {
    const event: NostrEvent = {
      id: "oob",
      pubkey: "0".repeat(64),
      created_at: 1234,
      kind: 38000,
      tags: [["d", `02${"0".repeat(64)}`]],
      content: "[7/5] wild overshoot",
      sig: "sig",
    };
    const parsed = parseRecommendation(event);
    // Regex only matches 1 digit before the slash; 7 is valid syntactically
    // but fails the 0..5 range check.
    expect(parsed?.rating).toBeUndefined();
  });

  it("returns null when `d` tag missing", () => {
    const event: NostrEvent = {
      id: "nod",
      pubkey: "0".repeat(64),
      created_at: 1234,
      kind: 38000,
      tags: [["k", "38172"]],
      content: "",
      sig: "sig",
    };
    expect(parseRecommendation(event)).toBeNull();
  });

  it("returns null for wrong kinds", () => {
    const event: NostrEvent = {
      id: "nod",
      pubkey: "0".repeat(64),
      created_at: 1234,
      kind: 1,
      tags: [["d", "x"]],
      content: "",
      sig: "sig",
    };
    expect(parseRecommendation(event)).toBeNull();
  });

  it("preserves `k` when numeric, omits when missing", () => {
    const withK: NostrEvent = {
      id: "a",
      pubkey: "0".repeat(64),
      created_at: 1,
      kind: 38000,
      tags: [
        ["d", `02${"0".repeat(64)}`],
        ["k", "38172"],
      ],
      content: "",
      sig: "sig",
    };
    const noK: NostrEvent = {
      id: "b",
      pubkey: "0".repeat(64),
      created_at: 1,
      kind: 38000,
      tags: [["d", `02${"0".repeat(64)}`]],
      content: "",
      sig: "sig",
    };
    expect(parseRecommendation(withK)?.k).toBe(38172);
    expect(parseRecommendation(noK)?.k).toBeUndefined();
  });
});
