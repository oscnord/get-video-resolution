import { describe, expect, test } from "bun:test";
import {
  normalizeLanguage,
  parsePositiveFloat,
  parsePositiveInt,
} from "../src/utils/manifest";

describe("manifest helpers", () => {
  describe("normalizeLanguage", () => {
    test("returns trimmed language", () => {
      expect(normalizeLanguage("en")).toBe("en");
      expect(normalizeLanguage("  sv  ")).toBe("sv");
    });

    test("returns undefined for 'und'", () => {
      expect(normalizeLanguage("und")).toBeUndefined();
    });

    test("returns undefined for empty/missing", () => {
      expect(normalizeLanguage("")).toBeUndefined();
      expect(normalizeLanguage("   ")).toBeUndefined();
      expect(normalizeLanguage(undefined)).toBeUndefined();
    });
  });

  describe("parsePositiveInt", () => {
    test("parses positive integers", () => {
      expect(parsePositiveInt("1920")).toBe(1920);
    });

    test("rejects zero, negatives, and non-numbers", () => {
      expect(parsePositiveInt("0")).toBeUndefined();
      expect(parsePositiveInt("-5")).toBeUndefined();
      expect(parsePositiveInt("abc")).toBeUndefined();
      expect(parsePositiveInt(undefined)).toBeUndefined();
    });
  });

  describe("parsePositiveFloat", () => {
    test("parses fractional values", () => {
      expect(parsePositiveFloat("29.97")).toBe(29.97);
    });

    test("rejects zero, negatives, and non-numbers", () => {
      expect(parsePositiveFloat("0")).toBeUndefined();
      expect(parsePositiveFloat("-1.5")).toBeUndefined();
      expect(parsePositiveFloat("abc")).toBeUndefined();
      expect(parsePositiveFloat(undefined)).toBeUndefined();
    });
  });
});
