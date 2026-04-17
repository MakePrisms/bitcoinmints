import { describe, expect, it } from "vitest";
import { D_TAG_REGEX, isValidCashuDTag } from "./dtag";

describe("isValidCashuDTag (post-relaxation)", () => {
  // Per PR #32 follow-up: the Layer A d-tag shape gate was relaxed because
  // 99.8% of real on-wire kind:38172 events use 16-char random d-tags
  // pointing at legitimate mint URLs. The regex now accepts any non-empty
  // printable-ASCII string up to 256 chars; URL + Layer B signer binding
  // are the real verification gates.

  describe("accepts curator-style d-tags (real ecosystem shape)", () => {
    it("accepts a 16-char random d-tag from the real curator burst", () => {
      // These were incorrectly labeled "bot spam" before the 2026-04-17
      // browser audit. Real mints (mint.azzamo.net, mint.lnw.cash, etc.)
      // publish under random 16-char d-tags.
      expect(isValidCashuDTag("ewakfwchz6tmlmvy")).toBe(true);
      expect(isValidCashuDTag("rp8l2ez6vw3t4u2j")).toBe(true);
      expect(isValidCashuDTag("psvef0yh2zk24tt7")).toBe(true);
      expect(isValidCashuDTag("abc123def4567890")).toBe(true);
    });

    it("accepts a 66-char compressed secp256k1 d-tag (spec-conforming)", () => {
      expect(isValidCashuDTag(`02${"0".repeat(64)}`)).toBe(true);
      expect(isValidCashuDTag(`03${"a".repeat(64)}`)).toBe(true);
    });

    it("accepts a 64-char x-only secp256k1 d-tag (de-facto form)", () => {
      // Nostrodomo Mint — real in-the-wild x-only pubkey d-tag.
      expect(
        isValidCashuDTag("5fe928ae0970844f3c5253d2e85a88788486edcbd96c070334a4a2d0d0154a77"),
      ).toBe(true);
    });

    it("accepts uppercase hex — case-insensitive in post-relaxation", () => {
      expect(isValidCashuDTag("A".repeat(64))).toBe(true);
      expect(
        isValidCashuDTag("5FE928AE0970844F3C5253D2E85A88788486EDCBD96C070334A4A2D0D0154A77"),
      ).toBe(true);
    });

    it("accepts short single-char d-tags (min boundary)", () => {
      expect(isValidCashuDTag("a")).toBe(true);
      expect(isValidCashuDTag("1")).toBe(true);
    });

    it("accepts d-tags at the 256-char maximum", () => {
      expect(isValidCashuDTag("a".repeat(256))).toBe(true);
    });

    it("accepts d-tags with mixed alphanumerics + common ASCII punctuation", () => {
      expect(isValidCashuDTag("mint-foo_bar.baz")).toBe(true);
      expect(isValidCashuDTag("some+curator/path?q=1")).toBe(true);
    });
  });

  describe("rejects only unambiguous garbage", () => {
    it("rejects empty string", () => {
      expect(isValidCashuDTag("")).toBe(false);
    });

    it("rejects too-long d-tag (>256 chars)", () => {
      expect(isValidCashuDTag("a".repeat(257))).toBe(false);
      expect(isValidCashuDTag("x".repeat(1024))).toBe(false);
    });

    it("rejects d-tags containing non-printable ASCII (control chars)", () => {
      expect(isValidCashuDTag("hello\nworld")).toBe(false);
      expect(isValidCashuDTag("\tindented")).toBe(false);
      expect(isValidCashuDTag("null\0byte")).toBe(false);
    });

    it("rejects d-tags containing high-byte / non-ASCII characters", () => {
      // U+00A0 NO-BREAK SPACE (0xA0) is outside the printable-ASCII range.
      expect(isValidCashuDTag("café-mint")).toBe(false);
      expect(isValidCashuDTag("héllo")).toBe(false);
      // Emoji is multi-byte non-ASCII.
      expect(isValidCashuDTag("mint🚀")).toBe(false);
    });
  });

  it("D_TAG_REGEX export is the live regex used by the validator", () => {
    expect(D_TAG_REGEX.test("a")).toBe(true);
    expect(D_TAG_REGEX.test("ewakfwchz6tmlmvy")).toBe(true);
    expect(D_TAG_REGEX.test("")).toBe(false);
    expect(D_TAG_REGEX.test("a".repeat(257))).toBe(false);
  });
});
