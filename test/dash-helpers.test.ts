import { describe, expect, test } from "bun:test";
import {
  iterateOpenTags,
  parseDashFrameRate,
  parseIso8601Duration,
  parseXmlAttrs,
} from "../src/parsers/dash-helpers";

describe("DASH helpers", () => {
  describe("iterateOpenTags", () => {
    test("yields self-closing tags with null body", () => {
      const xml = '<Representation id="1" width="1920" height="1080"/>';
      const out = [...iterateOpenTags(xml, "Representation")];
      expect(out).toHaveLength(1);
      expect(out[0].body).toBeNull();
      expect(out[0].attrs).toContain('width="1920"');
    });

    test("yields paired tags with body", () => {
      const xml =
        '<AdaptationSet mimeType="audio/mp4"><Representation id="a"/></AdaptationSet>';
      const out = [...iterateOpenTags(xml, "AdaptationSet")];
      expect(out).toHaveLength(1);
      expect(out[0].body).toContain("<Representation");
    });

    test("handles nested same-name tags via depth tracking", () => {
      const xml = "<Period><Period><Inner/></Period></Period>";
      const out = [...iterateOpenTags(xml, "Period")];
      expect(out).toHaveLength(1);
      expect(out[0].body).toBe("<Period><Inner/></Period>");
    });
  });

  describe("parseXmlAttrs", () => {
    test("parses double-quoted attributes", () => {
      const attrs = parseXmlAttrs('width="1920" height="1080" lang="en"');
      expect(attrs.get("width")).toBe("1920");
      expect(attrs.get("height")).toBe("1080");
      expect(attrs.get("lang")).toBe("en");
    });

    test("parses single-quoted attributes", () => {
      const attrs = parseXmlAttrs("width='1920'");
      expect(attrs.get("width")).toBe("1920");
    });

    test("handles colon-namespaced keys", () => {
      const attrs = parseXmlAttrs('xml:lang="en"');
      expect(attrs.get("xml:lang")).toBe("en");
    });
  });

  describe("parseDashFrameRate", () => {
    test("parses integer", () => {
      expect(parseDashFrameRate("30")).toBe(30);
    });

    test("parses fractional", () => {
      expect(parseDashFrameRate("30000/1001")).toBeCloseTo(29.97, 2);
    });

    test("returns undefined for /0", () => {
      expect(parseDashFrameRate("30/0")).toBeUndefined();
      expect(parseDashFrameRate("0/0")).toBeUndefined();
    });

    test("returns undefined for empty/invalid input", () => {
      expect(parseDashFrameRate("")).toBeUndefined();
      expect(parseDashFrameRate(undefined)).toBeUndefined();
      expect(parseDashFrameRate("abc")).toBeUndefined();
    });
  });

  describe("parseIso8601Duration", () => {
    test("parses hours, minutes, seconds", () => {
      expect(parseIso8601Duration("1H30M5S")).toBe(5405);
    });

    test("parses fractional seconds", () => {
      expect(parseIso8601Duration("1.5S")).toBe(1.5);
    });

    test("returns undefined for empty input", () => {
      expect(parseIso8601Duration("")).toBeUndefined();
      expect(parseIso8601Duration(undefined)).toBeUndefined();
    });

    test("returns undefined for unparseable input", () => {
      expect(parseIso8601Duration("xyz")).toBeUndefined();
    });
  });
});
