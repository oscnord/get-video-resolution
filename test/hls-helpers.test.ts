import { describe, expect, test } from "bun:test";
import {
  isAudioCodec,
  iterateTagLines,
  parseAttrs,
  parsePositiveFloat,
  parsePositiveInt,
  parseResolution,
  splitCodecs,
} from "../src/parsers/hls-helpers";

describe("HLS helpers", () => {
  describe("iterateTagLines", () => {
    test("yields attribute strings for matching tag", () => {
      const content = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
1080p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720
720p.m3u8`;
      const lines = [...iterateTagLines(content, "EXT-X-STREAM-INF")];
      expect(lines).toHaveLength(2);
      expect(lines[0]).toBe("BANDWIDTH=5000000,RESOLUTION=1920x1080");
    });

    test("handles CRLF line endings", () => {
      const content = '#EXTM3U\r\n#EXT-X-MEDIA:TYPE=AUDIO,LANGUAGE="en"\r\n';
      const lines = [...iterateTagLines(content, "EXT-X-MEDIA")];
      expect(lines).toHaveLength(1);
      expect(lines[0]).toBe('TYPE=AUDIO,LANGUAGE="en"');
    });
  });

  describe("parseAttrs", () => {
    test("parses quoted and unquoted values", () => {
      const attrs = parseAttrs(
        'BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"',
      );
      expect(attrs.get("BANDWIDTH")).toBe("5000000");
      expect(attrs.get("RESOLUTION")).toBe("1920x1080");
      expect(attrs.get("CODECS")).toBe("avc1.640028,mp4a.40.2");
    });

    test("preserves commas inside quoted values", () => {
      const attrs = parseAttrs('CODECS="a,b,c",NAME="x"');
      expect(attrs.get("CODECS")).toBe("a,b,c");
      expect(attrs.get("NAME")).toBe("x");
    });

    test("handles missing value gracefully", () => {
      const attrs = parseAttrs("KEY=");
      expect(attrs.get("KEY")).toBe("");
    });
  });

  describe("splitCodecs", () => {
    test("splits comma-separated list", () => {
      expect(splitCodecs("avc1.640028, mp4a.40.2")).toEqual([
        "avc1.640028",
        "mp4a.40.2",
      ]);
    });

    test("returns empty array for undefined", () => {
      expect(splitCodecs(undefined)).toEqual([]);
    });
  });

  describe("isAudioCodec", () => {
    test("recognises common audio codecs", () => {
      expect(isAudioCodec("mp4a.40.2")).toBe(true);
      expect(isAudioCodec("ac-3")).toBe(true);
      expect(isAudioCodec("ec-3")).toBe(true);
      expect(isAudioCodec("opus")).toBe(true);
      expect(isAudioCodec("flac")).toBe(true);
    });

    test("rejects video codecs", () => {
      expect(isAudioCodec("avc1.640028")).toBe(false);
      expect(isAudioCodec("hvc1.2.4.L150.B0")).toBe(false);
      expect(isAudioCodec("av01.0.04M.10")).toBe(false);
    });
  });

  describe("parseResolution", () => {
    test("parses WxH", () => {
      expect(parseResolution("1920x1080")).toEqual({
        width: 1920,
        height: 1080,
      });
    });

    test("rejects 0 dimensions", () => {
      expect(parseResolution("0x1080")).toBeNull();
      expect(parseResolution("1920x0")).toBeNull();
    });

    test("rejects malformed input", () => {
      expect(parseResolution("not-a-resolution")).toBeNull();
      expect(parseResolution(undefined)).toBeNull();
    });
  });

  describe("parsePositiveInt / parsePositiveFloat", () => {
    test("returns positive integers", () => {
      expect(parsePositiveInt("42")).toBe(42);
      expect(parsePositiveInt("0")).toBeUndefined();
      expect(parsePositiveInt(undefined)).toBeUndefined();
    });

    test("returns positive floats", () => {
      expect(parsePositiveFloat("29.97")).toBe(29.97);
      expect(parsePositiveFloat("0")).toBeUndefined();
      expect(parsePositiveFloat(undefined)).toBeUndefined();
    });
  });
});
