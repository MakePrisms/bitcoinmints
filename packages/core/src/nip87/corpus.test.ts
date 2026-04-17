import type { Event as NostrEvent } from "nostr-tools/core";
import { describe, expect, it } from "vitest";
import fixtures from "./__fixtures__/nip87-sample.json" with { type: "json" };
import { isValidCashuDTag } from "./dtag";
import { parseMintAnnouncement, parseRecommendation } from "./parse";

type Fixture = {
  _meta: Record<string, unknown>;
  cashu38172Curator: NostrEvent[];
  cashu38172Legacy: NostrEvent[];
  cashu38172SpecConforming: NostrEvent[];
  fedimint38173: NostrEvent[];
  recommendations38000: NostrEvent[];
};
const f = fixtures as unknown as Fixture;

/**
 * Empirical-findings assertions for the curated corpus at
 * __fixtures__/nip87-sample.json. See that file's `_meta.notes` for the
 * provenance and composition.
 */
describe("NIP-87 corpus", () => {
  it("has the expected event counts per bucket", () => {
    expect(f.cashu38172Curator.length).toBe(5);
    expect(f.cashu38172Legacy.length).toBe(1);
    expect(f.cashu38172SpecConforming.length).toBe(2);
    expect(f.fedimint38173.length).toBe(3);
    expect(f.recommendations38000.length).toBe(5);

    const total =
      f.cashu38172Curator.length +
      f.cashu38172Legacy.length +
      f.cashu38172SpecConforming.length +
      f.fedimint38173.length +
      f.recommendations38000.length;
    expect(total).toBe(16);
  });

  it("Layer A accepts all Cashu announcements post-relaxation (curator + legacy + spec-conforming)", () => {
    const all38172: NostrEvent[] = [
      ...f.cashu38172Curator,
      ...f.cashu38172Legacy,
      ...f.cashu38172SpecConforming,
    ];
    expect(all38172.length).toBe(8);

    const parsed = all38172
      .map((e) => parseMintAnnouncement(e))
      .filter((a): a is NonNullable<typeof a> => a !== null);
    // All 8 parse successfully (parse does NOT gate on Layer A).
    expect(parsed.length).toBe(8);

    const accepted = parsed.filter((a) => isValidCashuDTag(a.d));
    const rejected = parsed.filter((a) => !isValidCashuDTag(a.d));

    // All 8 accepted post-relaxation: 5 curator (16-char) + 1 legacy (64-char)
    // + 2 spec-conforming (66-char). Rejection is reserved for empty / oversized
    // / non-printable garbage, none of which appear in the corpus.
    expect(accepted.length).toBe(8);
    expect(rejected.length).toBe(0);
  });

  it("Layer A accepts all 5 curator events (16-char d-tags are legitimate)", () => {
    for (const e of f.cashu38172Curator) {
      const parsed = parseMintAnnouncement(e);
      expect(parsed).not.toBeNull();
      expect(parsed && isValidCashuDTag(parsed.d)).toBe(true);
      // Sanity: the curator shape really is 16 chars.
      expect(parsed?.d.length).toBe(16);
    }
  });

  it("all curator events in the fixture belong to the 972f233a... publisher", () => {
    const CURATOR_PUBKEY = "972f233aa467bc9804032c0bce0a117daead5473c56c91e811a216bdd08c08cf";
    const curatorPubkeyCount = f.cashu38172Curator.filter(
      (e) => e.pubkey === CURATOR_PUBKEY,
    ).length;
    expect(curatorPubkeyCount).toBe(5);
  });

  it("Layer A accepts the 64-char x-only Nostrodomo announcement", () => {
    for (const e of f.cashu38172Legacy) {
      const parsed = parseMintAnnouncement(e);
      expect(parsed).not.toBeNull();
      expect(parsed && isValidCashuDTag(parsed.d)).toBe(true);
      // Sanity: it really is 64 chars, not 66.
      expect(parsed?.d.length).toBe(64);
    }
  });

  it("Fedimint still uses its own (stricter) shape gate — unchanged by the Cashu relaxation", () => {
    const parsedFedi = f.fedimint38173
      .map((e) => parseMintAnnouncement(e))
      .filter((a): a is NonNullable<typeof a> => a !== null);
    expect(parsedFedi.length).toBe(f.fedimint38173.length);

    for (const parsed of parsedFedi) {
      expect(parsed.kind).toBe(38173);
      expect(parsed.nuts).toBeUndefined();
      // `modules` is optional — some Fedimint announcements omit it.
      if (parsed.modules !== undefined) {
        expect(Array.isArray(parsed.modules)).toBe(true);
        expect(parsed.modules.length).toBeGreaterThan(0);
      }
      // Intentionally don't call isValidCashuDTag on Fedimint events — the
      // cashu regex isn't semantically applicable.
    }

    // At least one of the curated fixtures should have modules populated.
    const withModules = parsedFedi.filter((a) => a.modules !== undefined);
    expect(withModules.length).toBeGreaterThanOrEqual(1);
  });

  it("every fixture recommendation parses", () => {
    for (const e of f.recommendations38000) {
      const parsed = parseRecommendation(e);
      expect(parsed).not.toBeNull();
      if (!parsed) continue;
      expect(parsed.kind).toBe(38000);
    }
  });

  it("the fixture covers multiple rating-format paths", () => {
    const parsed = f.recommendations38000
      .map((e) => parseRecommendation(e))
      .filter((r): r is NonNullable<typeof r> => r !== null);

    // At least one with rating, at least one without.
    const withRating = parsed.filter((r) => r.rating !== undefined);
    const withoutRating = parsed.filter((r) => r.rating === undefined);
    expect(withRating.length).toBeGreaterThanOrEqual(1);
    expect(withoutRating.length).toBeGreaterThanOrEqual(1);

    // All ratings in range [0,5].
    for (const r of withRating) {
      expect(r.rating).toBeGreaterThanOrEqual(0);
      expect(r.rating).toBeLessThanOrEqual(5);
    }
  });

  it("the fixture includes at least one rec that uses the 2-arg ['rating','N'] tag format", () => {
    const tagged = f.recommendations38000.filter((e) =>
      e.tags.some((t) => t[0] === "rating" && typeof t[1] === "string" && t[2] === undefined),
    );
    expect(tagged.length).toBeGreaterThanOrEqual(1);
  });

  it("the fixture includes at least one rec that relies on the [N/5] content regex", () => {
    const contentRating = f.recommendations38000.filter(
      (e) => e.tags.every((t) => t[0] !== "rating") && /(\d(?:\.\d+)?)\s*\/\s*5/.test(e.content),
    );
    expect(contentRating.length).toBeGreaterThanOrEqual(1);
  });
});
