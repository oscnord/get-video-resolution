import { describe, expect, test } from "bun:test";
import { parseFile } from "../src/parsers/file";
import { MediaParseError } from "../src/errors";
import { join } from "path";

const fixture = join(import.meta.dir, "fixtures", "test.mp4");

describe("File parser", () => {
  test("returns resolution from a local MP4 file", async () => {
    const result = await parseFile(fixture, {});
    expect(result.width).toBe(320);
    expect(result.height).toBe(240);
  });

  test("returns aspectRatio", async () => {
    const result = await parseFile(fixture, {});
    expect(result.aspectRatio).toBe("4:3");
  });

  test("returns codec as a string if available", async () => {
    const result = await parseFile(fixture, {});
    expect(typeof result.codec).toBe("string");
  });

  test("returns hdr as boolean", async () => {
    const result = await parseFile(fixture, {});
    expect(result.hdr).toBe(false);
  });

  test("returns duration if available", async () => {
    const result = await parseFile(fixture, {});
    if (result.duration !== undefined) {
      expect(typeof result.duration).toBe("number");
    }
  });
});
