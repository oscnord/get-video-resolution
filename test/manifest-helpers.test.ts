import { describe, expect, test } from "bun:test";
import { normalizeLanguage, pickCodec } from "../src/utils/manifest";

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

  describe("pickCodec", () => {
    test("returns first match", () => {
      expect(
        pickCodec(["avc1.64", "mp4a.40.2"], (c) => c.startsWith("mp4a")),
      ).toBe("mp4a.40.2");
    });

    test("falls back to first when no match", () => {
      expect(pickCodec(["avc1.64", "hvc1"], (c) => c.startsWith("av01"))).toBe(
        "avc1.64",
      );
    });

    test("returns undefined for empty list", () => {
      expect(pickCodec([], () => true)).toBeUndefined();
    });
  });
});
