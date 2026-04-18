/**
 * Unit tests for the kind:38000 review parser — each rating precedence
 * rule gets its own dedicated assertion so a regression in one format
 * can't be masked by a fallback.
 */
import type { Event as NostrEvent } from "nostr-tools/core";
import { describe, expect, it } from "vitest";
import { parseReview } from "./parse";

/** Realistic 64-char x-only Cashu d-tag. */
const D_VALID = "5fe928ae0970844f3c5253d2e85a88788486edcbd96c070334a4a2d0d0154a77";
/** 16-char legacy / bot-spam d-tag. */
const D_LEGACY_16 = "psvef0yh2zk24tt7";
/** Reviewer pubkey (also event signer) used in the synthetic `a` tag. */
const REVIEWER = "2".repeat(64);

/** Build a valid Cashu (k=38172) `a` tag for the given d-tag, signed by REVIEWER. */
function aTag(d: string, k: 38172 | 38173 = 38172, signer: string = REVIEWER): string[] {
  return ["a", `${k}:${signer}:${d}`];
}

/**
 * Auto-augment a tag-set so the parser accepts it: ensure `k` and `a` are
 * present (P0.3 + P1 made both required at parse time). Existing tests
 * pre-date that requirement and only specify the tags they're asserting on
 * — augmenting keeps each test focused without restating the boilerplate.
 *
 * Augmentation rules:
 *   - If no `k` tag, add `["k","38172"]`.
 *   - If no `a` tag, derive one from the present `d` and the resolved `k`.
 *   - If `d` is missing or empty, leave it alone — we want those tests to
 *     keep exercising the missing-d failure path.
 */
function withRequiredTags(tags: string[][]): string[][] {
  const out = tags.map((t) => [...t]);
  const hasK = out.some((t) => t[0] === "k");
  const hasA = out.some((t) => t[0] === "a");
  const dEntry = out.find((t) => t[0] === "d");
  const d = dEntry?.[1];
  if (!hasK) out.push(["k", "38172"]);
  if (!hasA && typeof d === "string" && d.length > 0) {
    const kStr = (out.find((t) => t[0] === "k")?.[1] ?? "38172") as string;
    const k = (kStr === "38173" ? 38173 : 38172) as 38172 | 38173;
    out.push(aTag(d, k));
  }
  return out;
}

function makeEvent(over: Partial<NostrEvent> & { tags?: string[][] } = {}): NostrEvent {
  const { tags: _baseTags, ...rest } = over;
  const baseTags = over.tags ?? [["d", D_VALID]];
  return {
    id: "1".repeat(64),
    pubkey: REVIEWER,
    created_at: 1_700_000_000,
    kind: 38000,
    content: "",
    sig: "",
    ...rest,
    tags: withRequiredTags(baseTags),
  } as NostrEvent;
}

describe("parseReview — basic structure", () => {
  it("returns null for non-38000 kinds", () => {
    const e = makeEvent({ kind: 1 as unknown as 38000 });
    expect(parseReview(e)).toBeNull();
  });

  it("returns null when the d tag is missing", () => {
    const e = makeEvent({ tags: [["k", "38172"]] });
    expect(parseReview(e)).toBeNull();
  });

  it("returns null when the d tag is present but empty", () => {
    const e = makeEvent({ tags: [["d", ""]] });
    expect(parseReview(e)).toBeNull();
  });

  it("preserves eventId, pubkey, d, createdAt, content, rawTags verbatim", () => {
    const e = makeEvent({
      id: "a".repeat(64),
      pubkey: "b".repeat(64),
      created_at: 1_800_000_000,
      content: "great mint",
      tags: [
        ["d", D_VALID],
        ["k", "38172"],
        ["rating", "4", "5"],
      ],
    });
    const row = parseReview(e);
    expect(row).not.toBeNull();
    if (!row) return;
    expect(row.eventId).toBe(e.id);
    expect(row.pubkey).toBe(e.pubkey);
    expect(row.d).toBe(D_VALID);
    expect(row.createdAt).toBe(e.created_at);
    expect(row.content).toBe("great mint");
    expect(row.rawTags).toEqual(e.tags);
    expect(row.kind).toBe(38000);
  });
});

describe("parseReview — rating formats (precedence)", () => {
  it("Format 1: structured tag ['rating','N','5'] wins — integer 1..5", () => {
    for (const n of [1, 2, 3, 4, 5]) {
      const row = parseReview(
        makeEvent({
          tags: [
            ["d", D_VALID],
            ["rating", String(n), "5"],
          ],
        }),
      );
      expect(row?.rating).toBe(n);
    }
  });

  it("Format 1: out-of-range N (0 or 6) falls through", () => {
    const below = parseReview(
      makeEvent({
        tags: [
          ["d", D_VALID],
          ["rating", "0", "5"],
        ],
      }),
    );
    // No fallback content, so rating is null.
    expect(below?.rating).toBeNull();

    const above = parseReview(
      makeEvent({
        tags: [
          ["d", D_VALID],
          ["rating", "6", "5"],
        ],
      }),
    );
    expect(above?.rating).toBeNull();
  });

  it("Format 2: legacy ['rating','N'] (no denominator) — integer 1..5", () => {
    for (const n of [1, 3, 5]) {
      const row = parseReview(
        makeEvent({
          tags: [
            ["d", D_VALID],
            ["rating", String(n)],
          ],
        }),
      );
      expect(row?.rating).toBe(n);
    }
  });

  it("Format 2: legacy ['rating','N'] with out-of-range N falls through", () => {
    const row = parseReview(
      makeEvent({
        tags: [
          ["d", D_VALID],
          ["rating", "7"],
        ],
      }),
    );
    expect(row?.rating).toBeNull();
  });

  it("Format 1 wins over Format 2 when both are present on the same event", () => {
    const row = parseReview(
      makeEvent({
        tags: [
          ["d", D_VALID],
          // Format 2 appears first…
          ["rating", "2"],
          // …but Format 1 wins even though it's second.
          ["rating", "5", "5"],
        ],
      }),
    );
    expect(row?.rating).toBe(5);
  });

  it("Format 3a: content `[N/5]` anchored at start", () => {
    const row = parseReview(
      makeEvent({
        tags: [["d", D_VALID]],
        content: "[4/5] decent mint",
      }),
    );
    expect(row?.rating).toBe(4);
  });

  it("Format 3a: content `N/5` without brackets", () => {
    const row = parseReview(
      makeEvent({
        tags: [["d", D_VALID]],
        content: "3/5 avg",
      }),
    );
    expect(row?.rating).toBe(3);
  });

  it("Format 3a: tag takes precedence over content even when both present", () => {
    const row = parseReview(
      makeEvent({
        tags: [
          ["d", D_VALID],
          ["rating", "2", "5"],
        ],
        content: "[5/5] content says five",
      }),
    );
    expect(row?.rating).toBe(2);
  });

  it("Format 3b: content `N/10` divides and rounds to nearest 1..5", () => {
    // 10/10 → 5, 8/10 → 4, 6/10 → 3, 4/10 → 2, 2/10 → 1.
    const cases: Array<[string, number]> = [
      ["10/10", 5],
      ["8/10 nice", 4],
      ["7/10", 4], // round-to-nearest: 3.5 → 4
      ["6/10", 3],
      ["5/10", 3], // round-to-nearest: 2.5 → 3 (banker's / half-up; Math.round uses half-away-from-zero)
      ["4/10", 2],
      ["3/10", 2], // 1.5 → 2
      ["2/10", 1],
    ];
    for (const [content, expected] of cases) {
      const row = parseReview(
        makeEvent({
          tags: [["d", D_VALID]],
          content,
        }),
      );
      expect(row?.rating).toBe(expected);
    }
  });

  it("Format 3b: `0/10` is treated as no-rating (doesn't fabricate a 1★)", () => {
    const row = parseReview(
      makeEvent({
        tags: [["d", D_VALID]],
        content: "0/10 total trash",
      }),
    );
    expect(row?.rating).toBeNull();
  });

  it("Format 3: /5 wins over /10 when both are present (5 is tried first)", () => {
    // Unlikely in practice but the ordering should be deterministic.
    const row = parseReview(
      makeEvent({
        tags: [["d", D_VALID]],
        content: "4/5 but also 8/10",
      }),
    );
    // Since 5-regex matches at index 0, it wins.
    expect(row?.rating).toBe(4);
  });

  it("Format 4: leading emoji run of 1..5 stars (⭐)", () => {
    const cases: Array<[string, number]> = [
      ["⭐ one star", 1],
      ["⭐⭐ two", 2],
      ["⭐⭐⭐ three", 3],
      ["⭐⭐⭐⭐ four", 4],
      ["⭐⭐⭐⭐⭐ five", 5],
    ];
    for (const [content, expected] of cases) {
      const row = parseReview(
        makeEvent({
          tags: [["d", D_VALID]],
          content,
        }),
      );
      expect(row?.rating).toBe(expected);
    }
  });

  it("Format 4: 🌟 glyph works too (both are accepted)", () => {
    const row = parseReview(
      makeEvent({
        tags: [["d", D_VALID]],
        content: "🌟🌟🌟 three stars",
      }),
    );
    expect(row?.rating).toBe(3);
  });

  it("Format 4: a run of 6+ emojis is out of range → null", () => {
    const row = parseReview(
      makeEvent({
        tags: [["d", D_VALID]],
        content: "⭐⭐⭐⭐⭐⭐",
      }),
    );
    expect(row?.rating).toBeNull();
  });

  it("Format 4: emoji not at start of content does not match", () => {
    const row = parseReview(
      makeEvent({
        tags: [["d", D_VALID]],
        content: "great mint ⭐⭐⭐⭐⭐",
      }),
    );
    expect(row?.rating).toBeNull();
  });

  it("Format 3 numeric wins over Format 4 emoji", () => {
    const row = parseReview(
      makeEvent({
        tags: [["d", D_VALID]],
        // `[4/5]` matches the numeric regex; the ⭐⭐⭐⭐⭐ after would
        // be 5, but we prefer the structured numeric.
        content: "[4/5] ⭐⭐⭐⭐⭐",
      }),
    );
    expect(row?.rating).toBe(4);
  });
});

describe("parseReview — malformed rating tag forms", () => {
  it("malformed rating tag forms fall through to null (no content fallback)", () => {
    // Each of these shapes is "structurally a rating tag" but the value
    // payload is unusable — either not a number, empty string, missing,
    // or `null`-as-string from a buggy emitter. None should parse to a
    // rating, and without a content rating signal all should land at null.
    const cases: string[][] = [
      ["rating", "foo", "5"],
      ["rating", ""],
      ["rating"],
      ["rating", "", "5"],
      // `null` coerced to a string via a buggy JSON emitter. The parser
      // guards `typeof t[1] !== "string"` which catches the raw-null
      // form; including it defensively in case a relay rewrites null
      // into the literal string "null".
      ["rating", null as unknown as string, "5"],
    ];
    for (const tag of cases) {
      const row = parseReview(makeEvent({ tags: [["d", D_VALID], tag as string[]] }));
      expect(row).not.toBeNull();
      expect(row?.rating).toBeNull();
    }
  });
});

describe("parseReview — null fallback", () => {
  it("returns rating: null when no rating tag and no content signal", () => {
    const row = parseReview(
      makeEvent({
        tags: [["d", D_VALID]],
        content: "just a plain review, no score",
      }),
    );
    expect(row?.rating).toBeNull();
  });

  it("returns rating: null for empty content and no tags", () => {
    const row = parseReview(makeEvent({ content: "" }));
    expect(row?.rating).toBeNull();
  });

  it("returns rating: null when content starts with a non-1..5 numeric", () => {
    const row = parseReview(
      makeEvent({
        tags: [["d", D_VALID]],
        content: "0/5 terrible",
      }),
    );
    // N=0 fails the 1..5 bounds check and no other format fires.
    expect(row?.rating).toBeNull();
  });
});

describe("parseReview — k tag enforcement (P0.3)", () => {
  it("k='38172' narrows to number 38172", () => {
    const row = parseReview(
      makeEvent({
        tags: [
          ["d", D_VALID],
          ["k", "38172"],
        ],
      }),
    );
    expect(row?.k).toBe(38172);
  });

  it("k='38173' narrows to number 38173", () => {
    // Use a Fedimint-style synthesised `a` tag that matches k=38173.
    // (withRequiredTags would default to k=38172 if no k were present, but
    // here we're explicitly testing k=38173 — provide our own a tag.)
    const row = parseReview({
      id: "1".repeat(64),
      pubkey: REVIEWER,
      created_at: 1_700_000_000,
      kind: 38000,
      tags: [["d", D_VALID], ["k", "38173"], aTag(D_VALID, 38173)],
      content: "",
      sig: "",
    } as unknown as NostrEvent);
    expect(row?.k).toBe(38173);
  });

  it("P0.3: k absent → parseReview returns null (rejected at parse)", () => {
    // The auto-augmenter in withRequiredTags adds k by default; bypass it
    // by hand-rolling an event where the entire tag set is supplied
    // raw — testing the strict gate.
    const row = parseReview({
      id: "1".repeat(64),
      pubkey: REVIEWER,
      created_at: 1_700_000_000,
      kind: 38000,
      tags: [["d", D_VALID]],
      content: "",
      sig: "",
    } as unknown as NostrEvent);
    expect(row).toBeNull();
  });

  it("P0.3: k unexpected ('1985') → parseReview returns null", () => {
    const row = parseReview({
      id: "1".repeat(64),
      pubkey: REVIEWER,
      created_at: 1_700_000_000,
      kind: 38000,
      tags: [
        ["d", D_VALID],
        ["k", "1985"],
        // no `a` tag either — k validation runs first regardless.
      ],
      content: "",
      sig: "",
    } as unknown as NostrEvent);
    expect(row).toBeNull();
  });

  it("P0.3 regression: review with k tag but no `a` tag → returns null", () => {
    // Parser rejects when the spec-required `a` tag is missing, even if
    // every other required field is present.
    const row = parseReview({
      id: "1".repeat(64),
      pubkey: REVIEWER,
      created_at: 1_700_000_000,
      kind: 38000,
      tags: [
        ["d", D_VALID],
        ["k", "38172"],
      ],
      content: "[5/5]",
      sig: "",
    } as unknown as NostrEvent);
    expect(row).toBeNull();
  });
});

describe("parseReview — `a` tag enforcement (P1)", () => {
  // Helper: build an event with a custom `a` tag (no auto-augment).
  function eventWithA(d: string, aValue: string | undefined, k: 38172 | 38173 = 38172): NostrEvent {
    const tags: string[][] = [
      ["d", d],
      ["k", String(k)],
    ];
    if (aValue !== undefined) tags.push(["a", aValue]);
    return {
      id: "1".repeat(64),
      pubkey: REVIEWER,
      created_at: 1_700_000_000,
      kind: 38000,
      tags,
      content: "",
      sig: "",
    } as unknown as NostrEvent;
  }

  it("happy path: well-formed a parses + lands on row.a verbatim", () => {
    const a = `38172:${REVIEWER}:${D_VALID}`;
    const row = parseReview(eventWithA(D_VALID, a));
    expect(row?.a).toBe(a);
  });

  it("rejects: a tag missing entirely", () => {
    expect(parseReview(eventWithA(D_VALID, undefined))).toBeNull();
  });

  it("rejects: malformed a (only one colon)", () => {
    expect(parseReview(eventWithA(D_VALID, `38172:${REVIEWER}`))).toBeNull();
  });

  it("rejects: malformed a (no colons)", () => {
    expect(parseReview(eventWithA(D_VALID, "garbage"))).toBeNull();
  });

  it("rejects: a's kind doesn't match the k tag", () => {
    // k=38172 but a says 38173 — disagreement → reject.
    expect(parseReview(eventWithA(D_VALID, `38173:${REVIEWER}:${D_VALID}`, 38172))).toBeNull();
  });

  it("rejects: a's pubkey isn't 64-char hex", () => {
    expect(parseReview(eventWithA(D_VALID, `38172:not-hex:${D_VALID}`))).toBeNull();
  });

  it("rejects: a's d portion doesn't match the event's d tag", () => {
    const otherD = "f".repeat(64);
    expect(parseReview(eventWithA(D_VALID, `38172:${REVIEWER}:${otherD}`))).toBeNull();
  });

  it("rejects: a's d portion is empty", () => {
    expect(parseReview(eventWithA(D_VALID, `38172:${REVIEWER}:`))).toBeNull();
  });
});

describe("parseReview — u tag collection (display helper)", () => {
  it("collects all u tag values into an array", () => {
    const row = parseReview(
      makeEvent({
        tags: [
          ["d", D_VALID],
          ["u", "https://mint.a.example", "cashu"],
          ["u", "https://mint.a.example/v1", "cashu"],
        ],
      }),
    );
    expect(row?.u).toEqual(["https://mint.a.example", "https://mint.a.example/v1"]);
  });

  it("omits u entirely when the event has no u tags", () => {
    const row = parseReview(
      makeEvent({
        tags: [["d", D_VALID]],
      }),
    );
    expect(row?.u).toBeUndefined();
  });
});

describe("parseReview — parser is lenient on Layer A", () => {
  it("16-char legacy d-tag still parses (gate is at upsert, not parse)", () => {
    // The parser preserves whatever is there — bot-spam filtering is the
    // cache layer's job. This keeps parser usable by raw-event log views.
    const row = parseReview(
      makeEvent({
        tags: [["d", D_LEGACY_16]],
      }),
    );
    expect(row).not.toBeNull();
    expect(row?.d).toBe(D_LEGACY_16);
  });
});
