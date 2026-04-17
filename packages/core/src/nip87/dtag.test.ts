import { describe, expect, it } from "vitest";
import { D_TAG_REGEX, isValidCashuDTag } from "./dtag";

describe("isValidCashuDTag", () => {
  describe("valid — 66-char compressed secp256k1 pubkeys", () => {
    it("accepts a 02-prefixed 66-char lowercase hex d-tag", () => {
      expect(isValidCashuDTag(`02${"0".repeat(64)}`)).toBe(true);
    });

    it("accepts a 03-prefixed 66-char lowercase hex d-tag", () => {
      expect(isValidCashuDTag(`03${"a".repeat(64)}`)).toBe(true);
    });

    it("accepts a realistic-looking 02-prefixed pubkey", () => {
      // From a real kind:38000 recommendation's d-tag, pointing to lemonfizz mint.
      expect(
        isValidCashuDTag("03c5f16604678b8b118a454db12885e586f0fc146788d54182b3ca7943a327278e"),
      ).toBe(true);
    });

    it("accepts the full hex alphabet in a 66-char d-tag", () => {
      expect(isValidCashuDTag(`02${"0123456789abcdef".repeat(4)}`)).toBe(true);
    });
  });

  describe("valid — 64-char x-only secp256k1 pubkeys (de-facto form)", () => {
    it("accepts a real 64-char x-only d-tag (Nostrodomo Mint)", () => {
      expect(
        isValidCashuDTag("5fe928ae0970844f3c5253d2e85a88788486edcbd96c070334a4a2d0d0154a77"),
      ).toBe(true);
    });

    it("accepts a 64-char d-tag starting with 00", () => {
      // 64 chars, starts with 00 — would fail the 66-char branch but passes the 64-char branch.
      expect(isValidCashuDTag(`00${"0".repeat(62)}`)).toBe(true);
    });

    it("accepts a 64-char d-tag starting with ff", () => {
      // 64 chars, starts with ff — would fail the 66-char branch but passes the 64-char branch.
      expect(isValidCashuDTag(`ff${"0".repeat(62)}`)).toBe(true);
    });

    it("accepts the full hex alphabet in a 64-char d-tag", () => {
      expect(isValidCashuDTag("0123456789abcdef".repeat(4))).toBe(true);
    });
  });

  describe("invalid — shape mismatches", () => {
    it("rejects 16-char bot-spam d-tags", () => {
      // Real examples from the 972f233a... bot burst.
      expect(isValidCashuDTag("ewakfwchz6tmlmvy")).toBe(false);
      expect(isValidCashuDTag("rp8l2ez6vw3t4u2j")).toBe(false);
      expect(isValidCashuDTag("psvef0yh2zk24tt7")).toBe(false);
      expect(isValidCashuDTag("abc123def4567890")).toBe(false);
    });

    it("rejects 66-char d-tag with wrong prefix (uncompressed 04, or other)", () => {
      // 04 prefix = uncompressed — wrong kind for Cashu's compressed-secp256k1 slot.
      expect(isValidCashuDTag(`04${"0".repeat(64)}`)).toBe(false);
      expect(isValidCashuDTag(`01${"0".repeat(64)}`)).toBe(false);
      expect(isValidCashuDTag(`05${"0".repeat(64)}`)).toBe(false);
      expect(isValidCashuDTag(`ff${"0".repeat(64)}`)).toBe(false);
      expect(isValidCashuDTag(`aa${"0".repeat(64)}`)).toBe(false);
    });

    it("rejects 65-char d-tag (between the two valid lengths)", () => {
      expect(isValidCashuDTag(`02${"0".repeat(63)}`)).toBe(false);
      expect(isValidCashuDTag("0".repeat(65))).toBe(false);
    });

    it("rejects 67-char d-tag (one past 66)", () => {
      expect(isValidCashuDTag(`02${"0".repeat(65)}`)).toBe(false);
      expect(isValidCashuDTag("0".repeat(67))).toBe(false);
    });

    it("rejects too-short d-tag", () => {
      expect(isValidCashuDTag(`02${"0".repeat(10)}`)).toBe(false);
      expect(isValidCashuDTag("02")).toBe(false);
      expect(isValidCashuDTag("0".repeat(63))).toBe(false);
    });

    it("rejects too-long d-tag", () => {
      expect(isValidCashuDTag("0".repeat(128))).toBe(false);
      expect(isValidCashuDTag(`02${"0".repeat(128)}`)).toBe(false);
    });

    it("rejects non-hex characters (64-char length)", () => {
      expect(isValidCashuDTag("z".repeat(64))).toBe(false);
      expect(isValidCashuDTag("g".repeat(64))).toBe(false);
      expect(isValidCashuDTag(`${"0".repeat(63)}z`)).toBe(false);
    });

    it("rejects non-hex characters (66-char length)", () => {
      expect(isValidCashuDTag(`02${"z".repeat(64)}`)).toBe(false);
      expect(isValidCashuDTag(`02${"g".repeat(64)}`)).toBe(false);
      expect(isValidCashuDTag(`02!@#$%^&*()${"0".repeat(55)}`)).toBe(false);
    });

    it("rejects uppercase hex (64-char) — regex is case-sensitive", () => {
      expect(isValidCashuDTag("A".repeat(64))).toBe(false);
      expect(
        isValidCashuDTag("5FE928AE0970844F3C5253D2E85A88788486EDCBD96C070334A4A2D0D0154A77"),
      ).toBe(false);
    });

    it("rejects uppercase hex (66-char) — regex is case-sensitive", () => {
      expect(isValidCashuDTag(`02${"A".repeat(64)}`)).toBe(false);
      expect(
        isValidCashuDTag("02C5F16604678B8B118A454DB12885E586F0FC146788D54182B3CA7943A327278"),
      ).toBe(false);
    });

    it("rejects empty string", () => {
      expect(isValidCashuDTag("")).toBe(false);
    });

    it("rejects whitespace-only or whitespace-padded", () => {
      expect(isValidCashuDTag("   ")).toBe(false);
      expect(isValidCashuDTag(` 02${"0".repeat(64)}`)).toBe(false);
      expect(isValidCashuDTag(`02${"0".repeat(64)} `)).toBe(false);
      expect(isValidCashuDTag(` ${"0".repeat(64)}`)).toBe(false);
      expect(isValidCashuDTag(`${"0".repeat(64)} `)).toBe(false);
    });

    it("rejects the strings 'null' and 'undefined' (sanity: if coerced from non-string)", () => {
      expect(isValidCashuDTag("null")).toBe(false);
      expect(isValidCashuDTag("undefined")).toBe(false);
    });
  });

  it("D_TAG_REGEX export is the live regex used by the validator", () => {
    // 66-char branch live
    expect(D_TAG_REGEX.test(`02${"0".repeat(64)}`)).toBe(true);
    // 64-char branch live
    expect(D_TAG_REGEX.test("0".repeat(64))).toBe(true);
    // Nonsense rejected
    expect(D_TAG_REGEX.test("not-a-pubkey")).toBe(false);
  });
});
