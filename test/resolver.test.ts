import { describe, expect, test } from "bun:test";
import { getVideoResolution } from "../src/resolver";
import { UnsupportedSourceError } from "../src/errors";
import { join } from "path";

const fixturesDir = join(import.meta.dir, "fixtures");

describe("getVideoResolution", () => {
  test("routes .m3u8 to HLS parser and returns highest by default", async () => {
    const result = await getVideoResolution(join(fixturesDir, "master.m3u8"));
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
  });

  test("routes .mpd to DASH parser and returns highest by default", async () => {
    const result = await getVideoResolution(join(fixturesDir, "manifest.mpd"));
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
  });

  test("routes .mp4 to file parser", async () => {
    const result = await getVideoResolution(join(fixturesDir, "test.mp4"));
    expect(result.width).toBe(320);
    expect(result.height).toBe(240);
  });

  test("throws UnsupportedSourceError on empty source", async () => {
    await expect(getVideoResolution("")).rejects.toBeInstanceOf(
      UnsupportedSourceError,
    );
  });

  test("pick: lowest returns the smallest resolution", async () => {
    const result = await getVideoResolution(join(fixturesDir, "master.m3u8"), {
      pick: "lowest",
    });
    expect(result.width).toBe(640);
    expect(result.height).toBe(360);
  });

  test("pick: all returns all variants", async () => {
    const results = await getVideoResolution(
      join(fixturesDir, "master.m3u8"),
      { pick: "all" },
    );
    expect(Array.isArray(results)).toBe(true);
    expect((results as any[]).length).toBe(4);
  });

  test("returns VideoInfo fields (not just width/height)", async () => {
    const result = await getVideoResolution(join(fixturesDir, "master.m3u8"));
    expect(result).toHaveProperty("aspectRatio");
    expect(result).toHaveProperty("codec");
    expect(result).toHaveProperty("bitrate");
  });
});
