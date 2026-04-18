import type { Event as NostrEvent } from "nostr-tools/core";
import { describe, expect, it } from "vitest";
import fixtures from "./__fixtures__/nip87-sample.json" with { type: "json" };
import { isValidCashuDTag } from "./dtag";
import { parseMintAnnouncement, parseRecommendation } from "./parse";

type Fixture = {
  _meta: Record<string, unknown>;
  cashu38172BotSpam: NostrEvent[];
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
    expect(f.cashu38172BotSpam.length).toBe(5);
    expect(f.cashu38172Legacy.length).toBe(1);
    expect(f.cashu38172SpecConforming.length).toBe(2);
    expect(f.fedimint38173.length).toBe(3);
    expect(f.recommendations38000.length).toBe(5);

    const total =
      f.cashu38172BotSpam.length +
      f.cashu38172Legacy.length +
      f.cashu38172SpecConforming.length +
      f.fedimint38173.length +
      f.recommendations38000.length;
    expect(total).toBe(16);
  });

  it("Layer A accepts spec-conforming AND x-only Cashu announcements, rejects bot spam", () => {
    const all38172: NostrEvent[] = [
      ...f.cashu38172BotSpam,
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

    // 2 SpecConforming (66-char compressed) + 1 Legacy (64-char x-only) = 3 accepted.
    expect(accepted.length).toBe(3);
    // 5 bot-spam (16-char random) = 5 rejected.
    expect(rejected.length).toBe(5);
  });

  it("Layer A rejects all 5 bot-spam events (16-char d-tags)", () => {
    for (const e of f.cashu38172BotSpam) {
      const parsed = parseMintAnnouncement(e);
      expect(parsed).not.toBeNull();
      expect(parsed && isValidCashuDTag(parsed.d)).toBe(false);
    }
  });

  it("all bot-spam events in the fixture belong to the 972f233a... publisher", () => {
    const BOT_PUBKEY = "972f233aa467bc9804032c0bce0a117daead5473c56c91e811a216bdd08c08cf";
    const botPubkeyCount = f.cashu38172BotSpam.filter((e) => e.pubkey === BOT_PUBKEY).length;
    expect(botPubkeyCount).toBe(5);
  });

  it("Layer A accepts the 64-char x-only Nostrodomo announcement (de-facto mainstream shape)", () => {
    for (const e of f.cashu38172Legacy) {
      const parsed = parseMintAnnouncement(e);
      expect(parsed).not.toBeNull();
      expect(parsed && isValidCashuDTag(parsed.d)).toBe(true);
      // Sanity: it really is 64 chars, not 66.
      expect(parsed?.d.length).toBe(64);
    }
  });

  it("Layer A does NOT apply to Fedimint — all 3 parse, at least one has modules", () => {
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
      // TODO-v1.1: Fedimint d-tag is a federation id — no Layer A equivalent
      // yet. We deliberately do NOT call isValidCashuDTag on Fedimint events.
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
    // Mirrors the anchored-at-start canonical form (P1 unification).
    const contentRating = f.recommendations38000.filter(
      (e) => e.tags.every((t) => t[0] !== "rating") && /^\s*\[?\s*(\d+)\s*\/\s*5\b/.test(e.content),
    );
    expect(contentRating.length).toBeGreaterThanOrEqual(1);
  });
});
