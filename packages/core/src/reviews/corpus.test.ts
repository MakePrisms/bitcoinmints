/**
 * Corpus smoke test for the review pipeline. Uses a handful of real
 * kind:38000 events lifted from
 * /srv/forge/projects/bitcoinmints/audit/relay-data/recs-38000.json so the
 * parse → upsert → aggregate → rank chain is exercised against the actual
 * shapes relays emit — not just hand-written tests.
 *
 * Scope kept small (3 mints, ~8 events) so this file stays committable
 * without pulling a 32k-line JSON corpus into the package.
 */
import type { Event as NostrEvent } from "nostr-tools/core";
import { afterEach, describe, expect, it } from "vitest";
import { BitcoinmintsDB } from "../cache";
import { parseReview } from "./parse";
import { rankMints } from "./rank";
import { upsertReviewWithAggregate } from "./upsert";

const freshName = () => `test-review-corpus-${Math.random().toString(36).slice(2)}`;
const toDispose: BitcoinmintsDB[] = [];

afterEach(async () => {
  while (toDispose.length > 0) {
    const db = toDispose.pop();
    if (!db) continue;
    db.close();
    await BitcoinmintsDB.delete(db.name);
  }
});

async function freshDB(): Promise<BitcoinmintsDB> {
  const db = new BitcoinmintsDB(freshName());
  toDispose.push(db);
  await db.open();
  return db;
}

/**
 * Real kind:38000 events taken verbatim from the audit's relay dump. IDs,
 * signatures, and timestamps preserved. The d-tags are real Fedimint
 * federation IDs and Cashu mint pubkeys seen in the wild.
 *
 * Note: Fedimint federation IDs aren't constrained by the Layer A d-regex,
 * but this corpus uses 64-char hex which passes the regex either way.
 */
const REAL_EVENTS: NostrEvent[] = [
  // Fedimint 1 — 4 separate reviewers, all 5★.
  // Note: `a` tags added per P0.3 / P1 — NIP-87 reviews require the
  // `<kind>:<pubkey>:<d>` pointer. Real corpus events from the relay dump
  // don't always include `a` (the audit lists it as "optional" per spec
  // text), but our directory tightens to spec + brief: rejected at parse
  // when missing or malformed. Fixture events get fabricated `a` tags so
  // the parse → upsert chain is still exercisable.
  {
    content: "[5/5]",
    created_at: 1776360005,
    id: "50d2e3d560f5a312965ff977ed7755246de4dd64c03fdd5adf99caa587cb53d0",
    kind: 38000,
    pubkey: "1944cd868d0b996f58944b5748852d676e84f32c50cb224f65432ddf55045666",
    sig: "033a48b4844452784ffeecd9c379c1814f5c3386414a7f7f1e255ea11bfdd4686fc8fd287582971f9fa541fd64113119e7c882d9d6c3f2a3eecd90468acb5d1f",
    tags: [
      ["d", "27e032c0f1ff18213c3a94c2426f20a4000479b318712e93a7e56286fed00a2f"],
      ["k", "38173"],
      [
        "a",
        "38173:1944cd868d0b996f58944b5748852d676e84f32c50cb224f65432ddf55045666:27e032c0f1ff18213c3a94c2426f20a4000479b318712e93a7e56286fed00a2f",
      ],
      ["rating", "5"],
    ],
  },
  // Fedimint 2 — 3 reviewers, mix of ratings.
  {
    content: "[5/5]",
    created_at: 1776351305,
    id: "42c89639b9471d2f8aa9475731dde0873a3bb8d4b2dfa72d5162cd146d50fdd5",
    kind: 38000,
    pubkey: "3c00865afdb1dd2f8b68a9f802d0bbce2e6e9ebdb03f1a4686494a67e999b0a1",
    sig: "d2e3306255989bc52fb1ccfc25a282a7e79beb8a5bc7fd80e79ce16f5621093226b4642c7f8e8510860595612547fd7999d3b96cef80ea45a3531e6f9c426d71",
    tags: [
      ["d", "718e421be177486639330d198e870b7345ebd07b2866b5fd3797d73e4bc4c9af"],
      ["k", "38173"],
      [
        "a",
        "38173:3c00865afdb1dd2f8b68a9f802d0bbce2e6e9ebdb03f1a4686494a67e999b0a1:718e421be177486639330d198e870b7345ebd07b2866b5fd3797d73e4bc4c9af",
      ],
      ["rating", "5"],
    ],
  },
  {
    content: "[5/5]",
    created_at: 1776298850,
    id: "f22e2e76dca0d577a7695e45d5d0abd1ed6f5d6bc0e233c9e348c1b9339f8e6d",
    kind: 38000,
    pubkey: "82f1ae3bdd172c0ce69553165e8237e2fdf7fa32832707de130a274fcfaf1b10",
    sig: "549aad601d19a699eed21ae9ce9f9f35b855d7e5f898c933636c00f2397d34cddd3a80c7f89eb8efc5b867dfdb88c18dab0573022be1588d4b44f6c456bc71a2",
    tags: [
      ["d", "718e421be177486639330d198e870b7345ebd07b2866b5fd3797d73e4bc4c9af"],
      ["k", "38173"],
      [
        "a",
        "38173:82f1ae3bdd172c0ce69553165e8237e2fdf7fa32832707de130a274fcfaf1b10:718e421be177486639330d198e870b7345ebd07b2866b5fd3797d73e4bc4c9af",
      ],
      ["rating", "5"],
    ],
  },
  {
    // Manufactured 2★ on the same mint to ensure the aggregate mean is
    // actually computed (not a constant-5 test).
    content: "[2/5]",
    created_at: 1776298900,
    id: "f22e2e76dca0d577a7695e45d5d0abd1ed6f5d6bc0e348c1b9339f8e6cffffff",
    kind: 38000,
    pubkey: "92f1ae3bdd172c0ce69553165e8237e2fdf7fa32832707de130a274fcfaf1b11",
    sig: "00",
    tags: [
      ["d", "718e421be177486639330d198e870b7345ebd07b2866b5fd3797d73e4bc4c9af"],
      ["k", "38173"],
      [
        "a",
        "38173:92f1ae3bdd172c0ce69553165e8237e2fdf7fa32832707de130a274fcfaf1b11:718e421be177486639330d198e870b7345ebd07b2866b5fd3797d73e4bc4c9af",
      ],
      ["rating", "2", "5"],
    ],
  },
  // Fedimint 3 — single review.
  {
    content: "[5/5]",
    created_at: 1776291469,
    id: "e810bc759a3dac39ebfdf652df932d79d031712499618401fb8e01ed412c88c3",
    kind: 38000,
    pubkey: "ddc17385fdd1cc2df1e6f3a248c5a14ccaa9fcab17281d057e58965423de4617",
    sig: "a16145e091e36629c720ab791a34a6ece6e2b6ad94f8a61361fef06c96d3ef2f89c6b6b03e882d1281de71e05d0b4f89d068e29d00c6c8736c90a7c0a2970afd",
    tags: [
      ["d", "3beb71872cea0b97082ff1f6450e722903bc7ac09e5b4dc33105999f2901b4eb"],
      ["k", "38173"],
      [
        "a",
        "38173:ddc17385fdd1cc2df1e6f3a248c5a14ccaa9fcab17281d057e58965423de4617:3beb71872cea0b97082ff1f6450e722903bc7ac09e5b4dc33105999f2901b4eb",
      ],
      ["rating", "5"],
    ],
  },
];

describe("reviews: real corpus pipeline", () => {
  it("parses every event, materializes aggregates, ranks by damped bayesian", async () => {
    const db = await freshDB();

    // Parse every real event and push through the upsert+aggregate path.
    const results: string[] = [];
    for (const e of REAL_EVENTS) {
      const row = parseReview(e);
      expect(row).not.toBeNull();
      if (!row) continue;
      const r = await upsertReviewWithAggregate(db, row);
      results.push(r);
    }

    // Every real event inserted (no duplicates, no stale).
    expect(results).toEqual(["inserted", "inserted", "inserted", "inserted", "inserted"]);

    // 5 rows total.
    expect(await db.reviews.count()).toBe(5);

    // Three aggregates — one per distinct d.
    expect(await db.mintAggregate.count()).toBe(3);

    // Ranking order check. Federation with 3 rated reviews ((5+5+2)/3 ≈ 4.00
    // * log10(4)=0.602 → 2.408) outranks federation 1 with a single 5★
    // (5 * log10(2)=0.301 → 1.505) — even though fed1 has a higher
    // average. The single-5★ federation 3 is ranked equal to federation 1
    // (also 1.505) but Dexie breaks the tie deterministically on primary
    // key (the d string); either may come first — what matters is both
    // sort BELOW the 3-review federation.
    const ranked = await rankMints(db);
    expect(ranked).toHaveLength(3);
    expect(ranked[0]?.d).toBe("718e421be177486639330d198e870b7345ebd07b2866b5fd3797d73e4bc4c9af");
    expect(ranked[0]?.reviewCount).toBe(3);
    expect(ranked[0]?.ratedCount).toBe(3);
    expect(ranked[0]?.avgRating).toBeCloseTo((5 + 5 + 2) / 3, 6);
    expect(ranked[0]?.bayesianScore).toBeCloseTo((12 / 3) * Math.log10(4), 6);

    expect(ranked[1]?.bayesianScore).toBeCloseTo(5 * Math.log10(2), 6);
    expect(ranked[2]?.bayesianScore).toBeCloseTo(5 * Math.log10(2), 6);
    // Sort invariant: scores strictly non-increasing.
    expect(ranked[0]!.bayesianScore).toBeGreaterThan(ranked[1]!.bayesianScore);
    expect(ranked[1]!.bayesianScore).toBeCloseTo(ranked[2]!.bayesianScore, 6);
  });
});
