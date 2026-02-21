import { describe, expect, test } from "bun:test";
import { getVideoResolution } from "../src/resolver";
import { join } from "path";

const fixturesDir = join(import.meta.dir, "fixtures");

describe("getVideoResolution", () => {
  test("routes .m3u8 to HLS parser", async () => {
    const result = await getVideoResolution(join(fixturesDir, "master.m3u8"));
    expect(result).toEqual({ width: 1920, height: 1080 });
  });

  test("routes .mpd to DASH parser", async () => {
    const result = await getVideoResolution(join(fixturesDir, "manifest.mpd"));
    expect(result).toEqual({ width: 1920, height: 1080 });
  });

  test("routes .mp4 to file parser", async () => {
    const result = await getVideoResolution(join(fixturesDir, "test.mp4"));
    expect(result).toEqual({ width: 320, height: 240 });
  });

  test("throws on empty source", async () => {
    await expect(getVideoResolution("")).rejects.toThrow("Source is required");
  });
});
