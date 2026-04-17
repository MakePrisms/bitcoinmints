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

    it("accepts the full hex alphabet", () => {
      expect(isValidCashuDTag(`02${"0123456789abcdef".repeat(4)}`)).toBe(true);
    });
  });

  describe("invalid — shape mismatches", () => {
    it("rejects 16-char bot-spam d-tags", () => {
      // Real examples from the 972f233a... bot burst.
      expect(isValidCashuDTag("ewakfwchz6tmlmvy")).toBe(false);
      expect(isValidCashuDTag("rp8l2ez6vw3t4u2j")).toBe(false);
      expect(isValidCashuDTag("psvef0yh2zk24tt7")).toBe(false);
    });

    it("rejects legacy 64-char raw-pubkey d-tags (no 02/03 prefix)", () => {
      // Pre-spec bitcoinmints emitter shape.
      expect(
        isValidCashuDTag("5fe928ae0970844f3c5253d2e85a88788486edcbd96c070334a4a2d0d0154a77"),
      ).toBe(false);
    });

    it("rejects d-tag with wrong prefix (01/04/05)", () => {
      expect(isValidCashuDTag(`01${"0".repeat(64)}`)).toBe(false);
      expect(isValidCashuDTag(`04${"0".repeat(64)}`)).toBe(false);
      expect(isValidCashuDTag(`ff${"0".repeat(64)}`)).toBe(false);
    });

    it("rejects too-short d-tag", () => {
      expect(isValidCashuDTag(`02${"0".repeat(63)}`)).toBe(false);
      expect(isValidCashuDTag("02")).toBe(false);
    });

    it("rejects too-long d-tag", () => {
      expect(isValidCashuDTag(`02${"0".repeat(65)}`)).toBe(false);
    });

    it("rejects non-hex characters", () => {
      expect(isValidCashuDTag(`02${"z".repeat(64)}`)).toBe(false);
      expect(isValidCashuDTag(`02${"g".repeat(64)}`)).toBe(false);
      expect(isValidCashuDTag(`02!@#$%^&*()${"0".repeat(55)}`)).toBe(false);
    });

    it("rejects uppercase hex", () => {
      expect(isValidCashuDTag(`02${"A".repeat(64)}`)).toBe(false);
      expect(
        isValidCashuDTag("02C5F16604678B8B118A454DB12885E586F0FC146788D54182B3CA7943A32727"),
      ).toBe(false);
    });

    it("rejects empty string", () => {
      expect(isValidCashuDTag("")).toBe(false);
    });

    it("rejects whitespace-only or whitespace-padded", () => {
      expect(isValidCashuDTag("   ")).toBe(false);
      expect(isValidCashuDTag(` 02${"0".repeat(64)}`)).toBe(false);
      expect(isValidCashuDTag(`02${"0".repeat(64)} `)).toBe(false);
    });
  });

  it("D_TAG_REGEX export is the live regex used by the validator", () => {
    expect(D_TAG_REGEX.test(`02${"0".repeat(64)}`)).toBe(true);
    expect(D_TAG_REGEX.test("not-a-pubkey")).toBe(false);
  });
});
